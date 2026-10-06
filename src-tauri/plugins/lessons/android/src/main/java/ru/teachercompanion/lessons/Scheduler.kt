package ru.teachercompanion.lessons

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.ContentResolver
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Обновляет шторку, напоминания и виджеты «на сейчас» и ставит один будильник на следующий
 * момент, когда что-то изменится: звонок, напоминание, утренняя сводка или полночь.
 * Вызывается из приложения (после каждого изменения расписания), по будильнику,
 * после перезагрузки и смены времени.
 */
object Scheduler {
    /**
     * Звук канала Android менять не даёт — поэтому у каждого вида уведомлений два канала:
     * с перезвоном и только с вибрацией. «Беззвучно» — канал с вибрацией и тихое уведомление.
     */
    private class Alerting(
        val chime: String,
        val vibrate: String,
        val name: Int,
        val quietName: Int,
        val description: Int,
        val importance: Int,
    )

    private const val CHANNEL_SCHEDULE = "schedule"
    private const val CHANNEL_PLAN = "plan"
    private val REMINDERS = Alerting(
        "reminders_chime", "reminders_vibrate", R.string.tc_channel_reminders,
        R.string.tc_channel_reminders_vibrate, R.string.tc_channel_reminders_description,
        NotificationManager.IMPORTANCE_HIGH,
    )
    private val ENDING = Alerting(
        "ending_chime", "ending_vibrate", R.string.tc_channel_ending,
        R.string.tc_channel_ending_vibrate, R.string.tc_channel_ending_description,
        NotificationManager.IMPORTANCE_HIGH,
    )
    private val MORNING = Alerting(
        "morning_chime", "morning_vibrate", R.string.tc_channel_morning,
        R.string.tc_channel_morning_vibrate, R.string.tc_channel_morning_description,
        NotificationManager.IMPORTANCE_DEFAULT,
    )
    private val EVENING = Alerting(
        "evening_chime", "evening_vibrate", R.string.tc_channel_evening,
        R.string.tc_channel_evening_vibrate, R.string.tc_channel_evening_description,
        NotificationManager.IMPORTANCE_DEFAULT,
    )
    /** Каналы до 0.13: со стандартным звуком телефона. */
    private val OLD_CHANNELS = listOf("reminders", "morning")
    private const val ID_ONGOING = 1
    private const val ID_MORNING = 2
    private const val ID_PLAN = 3
    private const val ID_PREVIEW = 4
    private const val ID_EVENING = 5
    private const val ID_REMINDER = 100
    private const val ID_ENDING = 200

    /** Короткая двойная вибрация — заметно в кармане, но не тревожно. */
    private val VIBRATION = longArrayOf(0, 180, 120, 180)

    /** Расписание в шторке появляется за час до первого урока. */
    private const val ONGOING_AHEAD = 60 * 60_000L

    /** Утренняя сводка не приходит, если опоздала больше чем на два часа (телефон был выключен). */
    private const val MORNING_WINDOW = 2 * 60 * 60_000L

    /** Вечерняя сводка опоздавшей не приходит позже чем через три часа — и не после полуночи. */
    private const val EVENING_WINDOW = 3 * 60 * 60_000L

    fun refresh(context: Context) {
        val app = context.applicationContext
        val plan = Plan.load(app)
        val now = System.currentTimeMillis()
        channels(app)
        if (plan == null) {
            NotificationManagerCompat.from(app).cancel(ID_ONGOING)
            Widgets.updateAll(app, null, now)
            return
        }
        ongoing(app, plan, now)
        reminder(app, plan, now)
        ending(app, plan, now)
        morning(app, plan, now)
        evening(app, plan, now)
        expiry(app, plan, now)
        Widgets.updateAll(app, plan, now)
        schedule(app, next(plan, now))
    }

    private fun channels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val schedule = NotificationChannel(
            CHANNEL_SCHEDULE,
            context.getString(R.string.tc_channel_schedule),
            NotificationManager.IMPORTANCE_LOW,
        )
        schedule.description = context.getString(R.string.tc_channel_schedule_description)
        schedule.setShowBadge(false)
        val plan = NotificationChannel(
            CHANNEL_PLAN,
            context.getString(R.string.tc_channel_plan),
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        plan.description = context.getString(R.string.tc_channel_plan_description)
        val alerting = listOf(REMINDERS, ENDING, MORNING, EVENING).flatMap {
            listOf(
                channel(context, it.chime, it.name, it, true),
                channel(context, it.vibrate, it.quietName, it, false),
            )
        }
        manager.createNotificationChannels(listOf(schedule) + alerting + plan)
        for (id in OLD_CHANNELS) manager.deleteNotificationChannel(id)
    }

    private fun channel(
        context: Context,
        id: String,
        name: Int,
        kind: Alerting,
        chime: Boolean,
    ): NotificationChannel {
        val channel = NotificationChannel(id, context.getString(name), kind.importance)
        channel.description = context.getString(kind.description)
        channel.setSound(if (chime) chimeUri(context) else null, if (chime) chimeAudio() else null)
        channel.enableVibration(true)
        channel.vibrationPattern = VIBRATION
        return channel
    }

    private fun chimeUri(context: Context): Uri =
        Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/${R.raw.tc_chime}")

    private fun chimeAudio(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    /**
     * Канал под выбранный звук, а для Android 7 и старше — звук и вибрация прямо в уведомлении:
     * там каналов нет.
     */
    private fun alert(context: Context, kind: Alerting, sound: Sound): NotificationCompat.Builder {
        val builder = base(context, if (sound == Sound.CHIME) kind.chime else kind.vibrate)
        when (sound) {
            Sound.CHIME -> builder.setSound(chimeUri(context), AudioManager.STREAM_NOTIFICATION)
                .setVibrate(VIBRATION)
            Sound.VIBRATE -> builder.setVibrate(VIBRATION)
            Sound.SILENT -> builder.setSilent(true)
        }
        return builder
    }

    /** «Тихо во время уроков»: пока идёт урок, перезвон заменяется вибрацией. */
    private fun quieted(plan: Plan, now: Long, sound: Sound): Sound =
        if (sound == Sound.CHIME && plan.prefs.quiet && Moment.of(plan, now) is Moment.During)
            Sound.VIBRATE
        else sound

    fun openApp(context: Context, request: Int): PendingIntent? {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: return null
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
        return PendingIntent.getActivity(
            context,
            request,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun base(context: Context, channel: String): NotificationCompat.Builder =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.tc_ic_stat)
            .setColor(ContextCompat.getColor(context, R.color.tc_accent))
            .setContentIntent(openApp(context, 0))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    private fun notify(context: Context, id: Int, builder: NotificationCompat.Builder) {
        try {
            NotificationManagerCompat.from(context).notify(id, builder.build())
        } catch (e: SecurityException) {
            // Уведомления не разрешены — приложение покажет кнопку «Разрешить».
        }
    }

    /** Текущий урок с отсчётом до звонка — или следующий, если сейчас перемена. */
    private fun ongoing(context: Context, plan: Plan, now: Long) {
        val manager = NotificationManagerCompat.from(context)
        val day = plan.day(now)
        val first = day?.lessons?.firstOrNull()
        val moment = Moment.of(plan, now)
        val visible = plan.prefs.ongoing && first != null && now >= first.start - ONGOING_AHEAD &&
            (moment is Moment.During || moment is Moment.Before)
        if (!visible) {
            manager.cancel(ID_ONGOING)
            return
        }
        val builder = base(context, CHANNEL_SCHEDULE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setSubText(Words.lessons(day!!.lessons.size) + if (day.short) " · сокращённые" else "")
        when (moment) {
            is Moment.During -> {
                val l = moment.lesson
                val next = moment.next?.let { "далее ${it.className} в ${it.startText}" }
                    ?: "последний урок"
                val text = "${l.number}-й урок до ${l.endText} · $next"
                builder.setContentTitle(l.title)
                    .setContentText(text)
                    .setWhen(l.end)
                    .setProgress((l.end - l.start).toInt(), (now - l.start).toInt(), false)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(withNote(text, l)))
            }
            is Moment.Before -> {
                val l = moment.lesson
                val text = "${l.number}-й урок в ${l.startText}" +
                    if (moment.previous != null) " · перемена" else " · первый"
                builder.setContentTitle("Далее: ${l.title}")
                    .setContentText(text)
                    .setWhen(l.start)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(withNote(text, l)))
            }
            else -> Unit
        }
        notify(context, ID_ONGOING, builder)
    }

    private fun withNote(text: String, lesson: Lesson) =
        if (lesson.note.isBlank()) text else "$text\n✎ ${lesson.note}"

    /** «Через 5 минут — 7Б» за `remind` минут до урока, один раз. */
    private fun reminder(context: Context, plan: Plan, now: Long) {
        val minutes = plan.prefs.remind
        if (minutes <= 0) return
        val lesson = plan.day(now)?.lessons?.firstOrNull {
            now >= it.start - minutes * 60_000L && now < it.start
        } ?: return
        val key = "${Plan.dateKey(now)}:remind:${lesson.number}"
        if (Plan.shown(context, key)) return
        Plan.markShown(context, key)
        val left = ((lesson.start - now + 59_999) / 60_000).toInt()
        val builder = reminderContent(context, quieted(plan, now, plan.prefs.remindSound), lesson, left)
            .setTimeoutAfter(lesson.start + 10 * 60_000L - now)
        notify(context, ID_REMINDER + lesson.number, builder)
    }

    private fun reminderContent(
        context: Context,
        sound: Sound,
        lesson: Lesson,
        left: Int,
    ): NotificationCompat.Builder {
        val detail = listOfNotNull(
            "${lesson.number}-й урок в ${lesson.startText}",
            lesson.subject.takeIf { it.isNotBlank() },
        ).joinToString(" · ")
        return alert(context, REMINDERS, sound)
            .setContentTitle("Через $left мин — ${lesson.title}")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(withNote(detail, lesson)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
    }

    /** «Через 5 мин звонок — пора подводить итоги и задавать ДЗ» за `ending` минут до конца урока. */
    private fun ending(context: Context, plan: Plan, now: Long) {
        val minutes = plan.prefs.ending
        if (minutes <= 0) return
        val moment = Moment.of(plan, now) as? Moment.During ?: return
        val lesson = moment.lesson
        if (now < lesson.end - minutes * 60_000L) return
        val key = "${Plan.dateKey(now)}:ending:${lesson.number}"
        if (Plan.shown(context, key)) return
        Plan.markShown(context, key)
        val left = ((lesson.end - now + 59_999) / 60_000).toInt()
        val builder = endingContent(context, plan, quieted(plan, now, plan.prefs.endingSound), moment, left)
            .setTimeoutAfter(lesson.end + 60_000L - now)
        notify(context, ID_ENDING + lesson.number, builder)
    }

    private fun endingContent(
        context: Context,
        plan: Plan,
        sound: Sound,
        moment: Moment.During,
        left: Int,
    ): NotificationCompat.Builder {
        val lesson = moment.lesson
        val message = plan.prefs.endingText
        val detail = "${lesson.number}-й урок до ${lesson.endText} · " +
            (moment.next?.let { "далее ${it.className} в ${it.startText}" } ?: "последний урок")
        return alert(context, ENDING, sound)
            .setContentTitle("Через $left мин звонок — ${lesson.className}")
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$message\n$detail"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
    }

    /** Утром — какой сегодня день, сколько уроков, какой первый и во сколько. */
    private fun morning(context: Context, plan: Plan, now: Long) {
        if (!plan.prefs.morning) return
        val day = plan.day(now) ?: return
        if (day.lessons.isEmpty()) return
        val at = day.dayStart + plan.prefs.morningAt * 60_000L
        val first = day.lessons.first()
        if (now < at || now > at + MORNING_WINDOW || now >= first.start) return
        val key = "${day.date}:morning"
        if (Plan.shown(context, key)) return
        Plan.markShown(context, key)
        val sound = quieted(plan, now, plan.prefs.morningSound)
        val builder = summary(context, MORNING, sound, day, "Сегодня")
            .setTimeoutAfter(first.start - now)
        notify(context, ID_MORNING, builder)
    }

    /** Вечером — что завтра: день, сколько уроков, первый урок и заметки. */
    private fun evening(context: Context, plan: Plan, now: Long) {
        if (!plan.prefs.evening) return
        val at = Plan.midnight(Plan.dateKey(now))!! + plan.prefs.eveningAt * 60_000L
        if (now < at || now > at + EVENING_WINDOW) return
        val tomorrow = plan.day(Plan.nextMidnight(now)) ?: return
        if (tomorrow.lessons.isEmpty()) return
        val key = "${tomorrow.date}:evening"
        if (Plan.shown(context, key)) return
        Plan.markShown(context, key)
        val sound = quieted(plan, now, plan.prefs.eveningSound)
        val builder = summary(context, EVENING, sound, tomorrow, "Завтра")
            .setTimeoutAfter(tomorrow.lessons.first().start - now)
        notify(context, ID_EVENING, builder)
    }

    /**
     * «Сегодня понедельник · 5 уроков», «Первый — 1-й урок в 08:30: 7Б · каб. 214»
     * и все уроки списком, с заметками.
     */
    private fun summary(
        context: Context,
        kind: Alerting,
        sound: Sound,
        day: Day,
        heading: String,
    ): NotificationCompat.Builder {
        val first = day.lessons.first()
        val list = day.lessons.joinToString("\n") {
            "${it.number}. ${it.startText}  ${it.title}" +
                (if (it.subject.isNotBlank()) " · ${it.subject}" else "") +
                if (it.note.isNotBlank()) "\n     ✎ ${it.note}" else ""
        }
        val title = "$heading ${Words.weekday(day)} · ${Words.lessons(day.lessons.size)}" +
            if (day.short) " · сокращённые" else ""
        val notes = day.lessons.count { it.note.isNotBlank() }
        val text = "Первый — ${first.number}-й урок в ${first.startText}: ${first.title}" +
            if (notes > 0) " · заметок: $notes" else ""
        return alert(context, kind, sound)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$text\n\n$list"))
            .setAutoCancel(true)
    }

    /**
     * «Проверить звук» в настройках: настоящее уведомление выбранного вида — на ближайших
     * уроках из плана, чтобы было видно и как оно выглядит.
     */
    fun preview(context: Context, kind: String, sound: Sound) {
        val app = context.applicationContext
        channels(app)
        val plan = Plan.load(app)
        val now = System.currentTimeMillis()
        val day = plan?.let { p -> p.day(now)?.takeIf { it.lessons.isNotEmpty() } ?: p.nextSchoolDay(now) }
        val builder = when (kind) {
            "morning", "evening" -> {
                val type = if (kind == "morning") MORNING else EVENING
                if (day != null) summary(app, type, sound, day, "Пример:")
                else alert(app, type, sound)
                    .setContentTitle(if (kind == "morning") "Пример утренней сводки" else "Пример сводки на завтра")
                    .setContentText("Здесь будут день недели, уроки и время первого")
                    .setAutoCancel(true)
            }
            "ending" -> {
                val moment = plan?.let { Moment.of(it, now) } as? Moment.During
                val lessons = day?.lessons.orEmpty()
                val sample = moment ?: lessons.firstOrNull()?.let { Moment.During(it, lessons.getOrNull(1)) }
                val minutes = plan?.prefs?.ending?.takeIf { it > 0 } ?: 5
                if (plan != null && sample != null) endingContent(app, plan, sound, sample, minutes)
                else alert(app, ENDING, sound)
                    .setContentTitle("Через $minutes мин звонок")
                    .setContentText(plan?.prefs?.endingText ?: Prefs.ENDING_TEXT)
                    .setAutoCancel(true)
            }
            else -> {
                val lesson = day?.lessons?.firstOrNull { it.start > now } ?: day?.lessons?.firstOrNull()
                val minutes = plan?.prefs?.remind?.takeIf { it > 0 } ?: 5
                if (lesson != null) reminderContent(app, sound, lesson, minutes)
                else alert(app, REMINDERS, sound)
                    .setContentTitle("Через $minutes мин — урок")
                    .setContentText("Пример напоминания перед уроком")
                    .setAutoCancel(true)
            }
        }
        // Повторное нажатие — снова со звуком, а не тихое обновление прежнего.
        NotificationManagerCompat.from(app).cancel(ID_PREVIEW)
        notify(app, ID_PREVIEW, builder.setTimeoutAfter(30_000L))
    }

    /**
     * План кончается — один раз попросить открыть приложение, оно пришлёт новый: за неделю
     * до конца и ещё раз, когда план кончился. Иначе шторка и напоминания пропали бы молча.
     */
    private fun expiry(context: Context, plan: Plan, now: Long) {
        if (!plan.endsSoon(now)) {
            NotificationManagerCompat.from(context).cancel(ID_PLAN)
            return
        }
        if (now < noticeAt(plan, now)) return
        val ended = plan.daysLeft(now) < 0
        val key = "${plan.until}:${if (ended) "ended" else "soon"}"
        if (Plan.noticed(context) == key) return
        Plan.markNoticed(context, key)
        val title: String
        val text: String
        if (ended) {
            title = "Расписание на телефоне закончилось"
            text = "Откройте «Помощник учителя», чтобы снова работали напоминания и виджеты."
        } else {
            title = "Расписание на телефоне — до ${Words.dayMonth(plan.until)}"
            text = "Откройте «Помощник учителя», чтобы напоминания и виджеты работали дальше."
        }
        val builder = base(context, CHANNEL_PLAN)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
        notify(context, ID_PLAN, builder)
    }

    /** О конце плана напоминаем утром, в час утренней сводки, — не ночью. */
    private fun noticeAt(plan: Plan, now: Long): Long =
        Plan.midnight(Plan.dateKey(now))!! + plan.prefs.morningAt * 60_000L

    /** Ближайший момент после `now`, когда что-то на экране должно измениться. */
    private fun next(plan: Plan, now: Long): Long {
        val times = ArrayList<Long>()
        times.add(Plan.nextMidnight(now))
        for (day in plan.days) {
            if (day.dayStart > now + 2 * 86_400_000L) break
            // Вечерняя сводка — каждый вечер: есть ли уроки завтра, решается в evening().
            if (plan.prefs.evening) times.add(day.dayStart + plan.prefs.eveningAt * 60_000L)
            val first = day.lessons.firstOrNull()
            if (first != null) {
                times.add(first.start - ONGOING_AHEAD)
                if (plan.prefs.morning) times.add(day.dayStart + plan.prefs.morningAt * 60_000L)
            }
            for (l in day.lessons) {
                times.add(l.start)
                times.add(l.end)
                if (plan.prefs.remind > 0) times.add(l.start - plan.prefs.remind * 60_000L)
                if (plan.prefs.ending > 0) times.add(l.end - plan.prefs.ending * 60_000L)
            }
        }
        // Во время урока полоска прогресса в шторке обновляется раз в 5 минут.
        val moment = Moment.of(plan, now)
        if (moment is Moment.During && plan.prefs.ongoing) times.add(now + 5 * 60_000L)
        // Напоминание о конце плана — сегодня утром или, если утро прошло, завтра.
        if (plan.endsSoon(now)) {
            times.add(noticeAt(plan, now))
            times.add(noticeAt(plan, Plan.nextMidnight(now)))
        }
        return times.filter { it > now + 500 }.minOrNull() ?: Plan.nextMidnight(now)
    }

    fun canExact(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }

    private fun schedule(context: Context, at: Long) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, AlarmReceiver::class.java).setAction(AlarmReceiver.ACTION)
        val pending = PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Чуть позже звонка — чтобы «сейчас» уже было после него.
        val time = at + 1_000
        try {
            if (canExact(context))
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, pending)
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, pending)
        } catch (e: SecurityException) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, pending)
        }
    }
}

/** Будильник, перезагрузка, обновление приложения, смена времени — всё пересчитать. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Scheduler.refresh(context)
    }

    companion object {
        const val ACTION = "ru.teachercompanion.lessons.REFRESH"
    }
}
