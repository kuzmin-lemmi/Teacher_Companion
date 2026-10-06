package ru.teachercompanion.lessons

import android.content.Context
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * План уроков, который присылает приложение (src/phone.ts): готовые дни на несколько недель
 * вперёд — с учётом каникул, сокращённых звонков и заметок. Здесь расписание не вычисляется,
 * только читается: уведомления и виджеты работают и при закрытом приложении.
 */
class Lesson(
    val number: Int,
    val className: String,
    val subject: String,
    val room: String,
    val start: Long,
    val end: Long,
    val startText: String,
    val endText: String,
    val note: String,
    /** Цвет предмета, как в приложении; null — без цвета. */
    val color: Int? = null,
) {
    /** «7Б · каб. 214» */
    val title: String
        get() = listOf(className, room.takeIf { it.isNotBlank() }?.let { "каб. $it" })
            .filterNotNull()
            .joinToString(" · ")
}

class Day(
    /** YYYY-MM-DD */
    val date: String,
    val dayStart: Long,
    val lessons: List<Lesson>,
    /** Каникулы или праздник: «Осенние каникулы · до 8 ноября». */
    val off: String,
    val short: Boolean,
)

class Prefs(
    /** Текущий или следующий урок в шторке и на экране блокировки. */
    val ongoing: Boolean,
    /** За сколько минут напомнить об уроке; 0 — не напоминать. */
    val remind: Int,
    val morning: Boolean,
    /** Минуты от полуночи. */
    val morningAt: Int,
    val remindSound: Sound = Sound.CHIME,
    val morningSound: Sound = Sound.CHIME,
    /** За сколько минут до конца урока напомнить про итоги и ДЗ; 0 — не напоминать. */
    val ending: Int = 0,
    val endingSound: Sound = Sound.VIBRATE,
    val endingText: String = ENDING_TEXT,
    /** Сводка на завтра вечером. */
    val evening: Boolean = false,
    /** Минуты от полуночи. */
    val eveningAt: Int = 19 * 60,
    val eveningSound: Sound = Sound.CHIME,
    /** Во время урока перезвон заменяется вибрацией. */
    val quiet: Boolean = true,
) {
    companion object {
        const val ENDING_TEXT = "Пора подводить итоги и задавать ДЗ"
    }
}

/** Как заявляет о себе уведомление: мягкий перезвон, только вибрация или беззвучно. */
enum class Sound {
    CHIME, VIBRATE, SILENT;

    companion object {
        fun of(text: String): Sound = when (text) {
            "vibrate" -> VIBRATE
            "silent" -> SILENT
            else -> CHIME
        }
    }
}

class Plan(val days: List<Day>, val prefs: Prefs) {
    /** Последний день плана: дальше телефон расписания не знает, пока не откроют приложение. */
    val until: String = days.lastOrNull()?.date ?: ""

    fun day(at: Long): Day? {
        val key = dateKey(at)
        return days.firstOrNull { it.date == key }
    }

    /** Ближайший после сегодняшнего день с уроками. */
    fun nextSchoolDay(at: Long): Day? {
        val key = dateKey(at)
        return days.firstOrNull { it.date > key && it.lessons.isNotEmpty() }
    }

    /** Сколько дней плана осталось после сегодняшнего: 0 — сегодня последний, < 0 — кончился. */
    fun daysLeft(at: Long): Int {
        val last = midnight(until) ?: return -1
        return Math.round((last - midnight(dateKey(at))!!) / 86_400_000.0).toInt()
    }

    /** План скоро кончится или уже кончился — пора открыть приложение, оно пришлёт новый. */
    fun endsSoon(at: Long): Boolean = daysLeft(at) <= WARN_DAYS

    companion object {
        /** За сколько дней до конца плана просить открыть приложение. */
        const val WARN_DAYS = 7
        private const val PREFS = "teacher_companion_lessons"
        private const val KEY = "plan"
        private const val NOTICE = "plan_notice"

        fun save(context: Context, json: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json)
                .apply()
        }

        fun load(context: Context): Plan? {
            val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, null) ?: return null
            return try {
                parse(raw)
            } catch (e: Exception) {
                null
            }
        }

        /** Отметки «уже показано» — чтобы напоминание не пришло дважды. */
        fun shown(context: Context, key: String): Boolean =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("shown:$key", false)

        fun markShown(context: Context, key: String) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val today = dateKey(System.currentTimeMillis())
            val editor = prefs.edit()
            // Старые отметки не копятся: ключ начинается с даты.
            for (name in prefs.all.keys)
                if (name.startsWith("shown:") && name.length >= 16 && name.substring(6, 16) < today)
                    editor.remove(name)
            editor.putBoolean("shown:$key", true).apply()
        }

        /** Какое напоминание о конце плана уже показано: `<последний день>:soon` или `:ended`. */
        fun noticed(context: Context): String? =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(NOTICE, null)

        fun markNoticed(context: Context, key: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(NOTICE, key)
                .apply()
        }

        fun parse(raw: String): Plan {
            val root = JSONObject(raw)
            val s = root.getJSONObject("settings")
            val prefs = Prefs(
                ongoing = s.optBoolean("ongoing", true),
                remind = s.optInt("remind", 5),
                morning = s.optBoolean("morning", false),
                morningAt = minutes(s.optString("morningTime", "07:30")) ?: (7 * 60 + 30),
                remindSound = Sound.of(s.optString("remindSound")),
                morningSound = Sound.of(s.optString("morningSound")),
                ending = s.optInt("ending", 0),
                endingSound = Sound.of(s.optString("endingSound", "vibrate")),
                endingText = s.optString("endingText").trim().ifEmpty { Prefs.ENDING_TEXT },
                evening = s.optBoolean("evening", false),
                eveningAt = minutes(s.optString("eveningTime", "19:00")) ?: (19 * 60),
                eveningSound = Sound.of(s.optString("eveningSound")),
                quiet = s.optBoolean("quiet", true),
            )
            val days = ArrayList<Day>()
            val list = root.getJSONArray("days")
            for (i in 0 until list.length()) {
                val d = list.getJSONObject(i)
                val date = d.getString("date")
                val start = midnight(date) ?: continue
                val lessons = ArrayList<Lesson>()
                val items = d.getJSONArray("lessons")
                for (j in 0 until items.length()) {
                    val l = items.getJSONObject(j)
                    val from = minutes(l.optString("start")) ?: continue
                    val to = minutes(l.optString("end")) ?: continue
                    lessons.add(
                        Lesson(
                            number = l.optInt("number"),
                            className = l.optString("className"),
                            subject = l.optString("subject"),
                            room = l.optString("room"),
                            start = start + from * 60_000L,
                            end = start + to * 60_000L,
                            startText = l.optString("start"),
                            endText = l.optString("end"),
                            note = l.optString("note"),
                            color = color(l.optString("color")),
                        ),
                    )
                }
                lessons.sortBy { it.start }
                days.add(Day(date, start, lessons, d.optString("off"), d.optBoolean("short")))
            }
            days.sortBy { it.date }
            return Plan(days, prefs)
        }

        /** «#rrggbb» → цвет; пусто или ошибка — без цвета. */
        fun color(text: String): Int? =
            if (Regex("^#[0-9a-fA-F]{6}$").matches(text)) android.graphics.Color.parseColor(text) else null

        fun minutes(text: String): Int? {
            val m = Regex("^(\\d\\d):(\\d\\d)$").find(text) ?: return null
            return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
        }

        /** Начало дня `YYYY-MM-DD` в часовом поясе телефона. */
        fun midnight(date: String): Long? {
            val m = Regex("^(\\d{4})-(\\d\\d)-(\\d\\d)$").find(date) ?: return null
            val c = Calendar.getInstance()
            c.clear()
            c.set(m.groupValues[1].toInt(), m.groupValues[2].toInt() - 1, m.groupValues[3].toInt())
            return c.timeInMillis
        }

        fun dateKey(at: Long): String {
            val c = Calendar.getInstance()
            c.timeInMillis = at
            // Цифры всегда латинские: при некоторых языках телефона ключ не совпал бы с планом.
            return String.format(
                Locale.ROOT,
                "%04d-%02d-%02d",
                c.get(Calendar.YEAR),
                c.get(Calendar.MONTH) + 1,
                c.get(Calendar.DAY_OF_MONTH),
            )
        }

        fun nextMidnight(at: Long): Long {
            val c = Calendar.getInstance()
            c.timeInMillis = at
            c.set(Calendar.HOUR_OF_DAY, 0)
            c.set(Calendar.MINUTE, 0)
            c.set(Calendar.SECOND, 0)
            c.set(Calendar.MILLISECOND, 0)
            c.add(Calendar.DAY_OF_MONTH, 1)
            return c.timeInMillis
        }
    }
}

/** Что сейчас: идёт урок, до урока (перемена или утро), уроки закончились или их нет. */
sealed class Moment {
    class During(val lesson: Lesson, val next: Lesson?) : Moment()
    class Before(val lesson: Lesson, val previous: Lesson?) : Moment()
    class After(val day: Day, val next: Day?) : Moment()
    class NoLessons(val day: Day?, val next: Day?) : Moment()

    companion object {
        fun of(plan: Plan, now: Long): Moment {
            val day = plan.day(now)
            val lessons = day?.lessons.orEmpty()
            if (day == null || lessons.isEmpty()) return NoLessons(day, plan.nextSchoolDay(now))
            val i = lessons.indexOfFirst { now < it.end }
            if (i < 0) return After(day, plan.nextSchoolDay(now))
            val lesson = lessons[i]
            return if (now >= lesson.start) During(lesson, lessons.getOrNull(i + 1))
            else Before(lesson, lessons.getOrNull(i - 1))
        }
    }
}

object Words {
    private val weekdays =
        arrayOf("воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота")
    private val months = arrayOf(
        "января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря",
    )

    fun lessons(n: Int): String {
        val mod = n % 100
        val word = when {
            mod in 11..14 -> "уроков"
            n % 10 == 1 -> "урок"
            n % 10 in 2..4 -> "урока"
            else -> "уроков"
        }
        return "$n $word"
    }

    /** «Завтра», «В четверг» или «В пятницу, 7 ноября» — относительно `now`. */
    fun whenDay(day: Day, now: Long): String {
        val c = Calendar.getInstance()
        c.timeInMillis = day.dayStart
        val days = Math.round((day.dayStart - Plan.midnight(Plan.dateKey(now))!!) / 86_400_000.0)
        val weekday = weekdays[c.get(Calendar.DAY_OF_WEEK) - 1]
        val on = if (weekday == "вторник") "Во" else "В"
        val name = when (weekday) {
            "среда" -> "среду"
            "пятница" -> "пятницу"
            else -> weekday
        }
        return when {
            days == 1L -> "Завтра"
            days < 7 -> "$on $name"
            else -> "$on $name, ${c.get(Calendar.DAY_OF_MONTH)} ${months[c.get(Calendar.MONTH)]}"
        }
    }

    /** «вторник» */
    fun weekday(day: Day): String {
        val c = Calendar.getInstance()
        c.timeInMillis = day.dayStart
        return weekdays[c.get(Calendar.DAY_OF_WEEK) - 1]
    }

    /** «Вторник, 29 сентября» */
    fun date(day: Day): String {
        val c = Calendar.getInstance()
        c.timeInMillis = day.dayStart
        val weekday = weekdays[c.get(Calendar.DAY_OF_WEEK) - 1]
        return "${weekday.replaceFirstChar { it.uppercase() }}, " +
            "${c.get(Calendar.DAY_OF_MONTH)} ${months[c.get(Calendar.MONTH)]}"
    }

    /** «8 ноября» для `YYYY-MM-DD` */
    fun dayMonth(date: String): String {
        val c = Calendar.getInstance()
        c.timeInMillis = Plan.midnight(date) ?: return date
        return "${c.get(Calendar.DAY_OF_MONTH)} ${months[c.get(Calendar.MONTH)]}"
    }

    /** Виджет, когда план кончился или дальше в нём нет уроков: нажатие откроет приложение. */
    const val REFRESH = "Нажмите, чтобы обновить расписание"

    /** «Завтра 6 уроков с 08:30» */
    fun nextDay(plan: Plan, day: Day?, now: Long): String = when {
        day != null ->
            "${whenDay(day, now)} ${lessons(day.lessons.size)} с ${day.lessons.first().startText}"
        // Дальше плана телефон не видит: уроки там могут быть, их просто ещё не прислали.
        plan.endsSoon(now) -> REFRESH
        else -> "Следующих уроков пока нет"
    }
}
