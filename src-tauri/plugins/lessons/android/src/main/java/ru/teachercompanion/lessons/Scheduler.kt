package ru.teachercompanion.lessons

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
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
    private const val CHANNEL_SCHEDULE = "schedule"
    private const val CHANNEL_REMINDERS = "reminders"
    private const val CHANNEL_MORNING = "morning"
    private const val CHANNEL_PLAN = "plan"
    private const val ID_ONGOING = 1
    private const val ID_MORNING = 2
    private const val ID_PLAN = 3
    private const val ID_REMINDER = 100

    /** Расписание в шторке появляется за час до первого урока. */
    private const val ONGOING_AHEAD = 60 * 60_000L

    /** Утренняя сводка не приходит, если опоздала больше чем на два часа (телефон был выключен). */
    private const val MORNING_WINDOW = 2 * 60 * 60_000L

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
        morning(app, plan, now)
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
        val reminders = NotificationChannel(
            CHANNEL_REMINDERS,
            context.getString(R.string.tc_channel_reminders),
            NotificationManager.IMPORTANCE_HIGH,
        )
        reminders.description = context.getString(R.string.tc_channel_reminders_description)
        val morning = NotificationChannel(
            CHANNEL_MORNING,
            context.getString(R.string.tc_channel_morning),
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        morning.description = context.getString(R.string.tc_channel_morning_description)
        val plan = NotificationChannel(
            CHANNEL_PLAN,
            context.getString(R.string.tc_channel_plan),
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        plan.description = context.getString(R.string.tc_channel_plan_description)
        manager.createNotificationChannels(listOf(schedule, reminders, morning, plan))
    }

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
        val detail = listOfNotNull(
            "${lesson.number}-й урок в ${lesson.startText}",
            lesson.subject.takeIf { it.isNotBlank() },
        ).joinToString(" · ")
        val builder = base(context, CHANNEL_REMINDERS)
            .setContentTitle("Через $left мин — ${lesson.title}")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(withNote(detail, lesson)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setTimeoutAfter(lesson.start + 10 * 60_000L - now)
        notify(context, ID_REMINDER + lesson.number, builder)
    }

    /** Утром — сколько сегодня уроков и когда первый. */
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
        val list = day.lessons.joinToString("\n") {
            "${it.number}. ${it.startText}  ${it.title}" +
                if (it.subject.isNotBlank()) " · ${it.subject}" else ""
        }
        val title = "Сегодня ${Words.lessons(day.lessons.size)}" +
            if (day.short) " · сокращённые" else ""
        val builder = base(context, CHANNEL_MORNING)
            .setContentTitle(title)
            .setContentText("${first.startText}–${day.lessons.last().endText} · первый ${first.title}")
            .setStyle(NotificationCompat.BigTextStyle().bigText(list))
            .setAutoCancel(true)
            .setTimeoutAfter(first.start - now)
        notify(context, ID_MORNING, builder)
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
            val first = day.lessons.firstOrNull()
            if (first != null) {
                times.add(first.start - ONGOING_AHEAD)
                if (plan.prefs.morning) times.add(day.dayStart + plan.prefs.morningAt * 60_000L)
            }
            for (l in day.lessons) {
                times.add(l.start)
                times.add(l.end)
                if (plan.prefs.remind > 0) times.add(l.start - plan.prefs.remind * 60_000L)
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
