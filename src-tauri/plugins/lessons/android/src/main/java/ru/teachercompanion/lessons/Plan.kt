package ru.teachercompanion.lessons

import android.content.Context
import org.json.JSONObject
import java.util.Calendar

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
)

class Plan(val days: List<Day>, val prefs: Prefs) {
    fun day(at: Long): Day? {
        val key = dateKey(at)
        return days.firstOrNull { it.date == key }
    }

    /** Ближайший после сегодняшнего день с уроками. */
    fun nextSchoolDay(at: Long): Day? {
        val key = dateKey(at)
        return days.firstOrNull { it.date > key && it.lessons.isNotEmpty() }
    }

    companion object {
        private const val PREFS = "teacher_companion_lessons"
        private const val KEY = "plan"

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

        fun parse(raw: String): Plan {
            val root = JSONObject(raw)
            val s = root.getJSONObject("settings")
            val prefs = Prefs(
                ongoing = s.optBoolean("ongoing", true),
                remind = s.optInt("remind", 5),
                morning = s.optBoolean("morning", false),
                morningAt = minutes(s.optString("morningTime", "07:30")) ?: (7 * 60 + 30),
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
                        ),
                    )
                }
                lessons.sortBy { it.start }
                days.add(Day(date, start, lessons, d.optString("off"), d.optBoolean("short")))
            }
            days.sortBy { it.date }
            return Plan(days, prefs)
        }

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
            return String.format(
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

    /** «Вторник, 29 сентября» */
    fun date(day: Day): String {
        val c = Calendar.getInstance()
        c.timeInMillis = day.dayStart
        val weekday = weekdays[c.get(Calendar.DAY_OF_WEEK) - 1]
        return "${weekday.replaceFirstChar { it.uppercase() }}, " +
            "${c.get(Calendar.DAY_OF_MONTH)} ${months[c.get(Calendar.MONTH)]}"
    }

    /** «Завтра 6 уроков с 08:30» */
    fun nextDay(day: Day?, now: Long): String =
        if (day == null) "Следующих уроков пока нет"
        else "${whenDay(day, now)} ${lessons(day.lessons.size)} с ${day.lessons.first().startText}"
}
