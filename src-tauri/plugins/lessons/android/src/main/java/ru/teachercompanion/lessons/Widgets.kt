package ru.teachercompanion.lessons

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat

/** «Сейчас и далее» — одна строка: текущий или следующий урок и отсчёт до звонка. */
class NowWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        Scheduler.refresh(context)
    }
}

/** «Уроки на день» — список уроков сегодня, после уроков — на следующий учебный день. */
class DayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        Scheduler.refresh(context)
    }

    /** Виджет растянули или сжали — пересчитать, сколько строк в него влезает. */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        options: Bundle,
    ) {
        Scheduler.refresh(context)
    }
}

object Widgets {
    private const val ROWS = 12

    fun ids(context: Context, kind: Class<*>): IntArray =
        AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, kind))

    fun count(context: Context) =
        ids(context, NowWidget::class.java).size + ids(context, DayWidget::class.java).size

    fun updateAll(context: Context, plan: Plan?, now: Long) {
        val manager = AppWidgetManager.getInstance(context)
        val nowIds = ids(context, NowWidget::class.java)
        if (nowIds.isNotEmpty()) manager.updateAppWidget(nowIds, nowViews(context, plan, now))
        // Каждый виджет «Уроки на день» — под свою высоту: в низкий влезает меньше строк.
        for (id in ids(context, DayWidget::class.java)) {
            val height = manager.getAppWidgetOptions(id)
                .getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
            manager.updateAppWidget(id, dayViews(context, plan, now, height))
        }
    }

    private fun timer(views: RemoteViews, target: Long, format: String, now: Long) {
        views.setChronometer(
            R.id.tc_now_timer,
            SystemClock.elapsedRealtime() + (target - now),
            format,
            true,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N)
            views.setChronometerCountDown(R.id.tc_now_timer, true)
        views.setViewVisibility(R.id.tc_now_timer, View.VISIBLE)
    }

    private fun nowViews(context: Context, plan: Plan?, now: Long): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.tc_widget_now)
        Scheduler.openApp(context, 1)?.let { views.setOnClickPendingIntent(R.id.tc_root, it) }
        views.setViewVisibility(R.id.tc_now_timer, View.GONE)
        if (plan == null) {
            views.setTextViewText(R.id.tc_now_title, "Помощник учителя")
            views.setTextViewText(R.id.tc_now_detail, "Откройте приложение, чтобы показать расписание")
            return views
        }
        if (plan.daysLeft(now) < 0) {
            // Без плана «Сегодня уроков нет» было бы неправдой: телефон просто не знает.
            views.setTextViewText(R.id.tc_now_title, "Расписание закончилось")
            views.setTextViewText(R.id.tc_now_detail, Words.REFRESH)
            return views
        }
        when (val moment = Moment.of(plan, now)) {
            is Moment.During -> {
                val l = moment.lesson
                views.setTextViewText(R.id.tc_now_title, l.title)
                // Коротко, чтобы влезало в одну строку: номер урока виден в списке на день.
                val next = moment.next?.let { "далее ${it.className} в ${it.startText}" }
                    ?: "последний урок"
                views.setTextViewText(R.id.tc_now_detail, "до ${l.endText} · $next")
                timer(views, l.end, "ещё %s", now)
            }
            is Moment.Before -> {
                val l = moment.lesson
                views.setTextViewText(R.id.tc_now_title, "Далее: ${l.title}")
                val detail = listOfNotNull(
                    "${l.number}-й урок в ${l.startText}",
                    l.subject.takeIf { it.isNotBlank() },
                ).joinToString(" · ")
                views.setTextViewText(R.id.tc_now_detail, detail)
                timer(views, l.start, "через %s", now)
            }
            is Moment.After -> {
                views.setTextViewText(R.id.tc_now_title, "Уроки закончились")
                views.setTextViewText(R.id.tc_now_detail, Words.nextDay(plan, moment.next, now))
            }
            is Moment.NoLessons -> {
                val off = moment.day?.off?.takeIf { it.isNotBlank() }
                views.setTextViewText(R.id.tc_now_title, off ?: "Сегодня уроков нет")
                views.setTextViewText(R.id.tc_now_detail, Words.nextDay(plan, moment.next, now))
            }
        }
        return views
    }

    private fun id(context: Context, name: String) =
        context.resources.getIdentifier(name, "id", context.packageName)

    /** Сколько строк уроков влезает в виджет высотой [height] dp; 0 — высота неизвестна. */
    private fun capacity(height: Int, notice: Boolean): Int {
        if (height <= 0) return ROWS
        // Отступы 22, заголовок 28, плашка «Сокращённые уроки» 20, строка 32 dp.
        val free = height - 22 - 28 - if (notice) 20 else 0
        return (free / 32).coerceIn(1, ROWS)
    }

    private fun dayViews(context: Context, plan: Plan?, now: Long, height: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.tc_widget_day)
        Scheduler.openApp(context, 2)?.let { views.setOnClickPendingIntent(R.id.tc_root, it) }
        // Лаунчер накладывает обновление на прошлый вид, поэтому всё задаётся явно, даже скрытое.
        views.setViewVisibility(R.id.tc_day_notice, View.GONE)
        views.setViewVisibility(R.id.tc_day_empty, View.VISIBLE)
        views.setTextViewText(R.id.tc_day_meta, "")
        for (i in 0 until ROWS) views.setViewVisibility(id(context, "tc_r$i"), View.GONE)
        if (plan == null) {
            views.setTextViewText(R.id.tc_day_title, "Уроки на день")
            views.setTextViewText(R.id.tc_day_empty, "Откройте приложение, чтобы показать расписание")
            return views
        }
        if (plan.daysLeft(now) < 0) {
            views.setTextViewText(R.id.tc_day_title, "Расписание закончилось")
            views.setTextViewText(R.id.tc_day_empty, Words.REFRESH)
            return views
        }
        val moment = Moment.of(plan, now)
        val today = plan.day(now)
        // До конца уроков — сегодня, потом — следующий учебный день, как в приложении.
        val day = when (moment) {
            is Moment.During, is Moment.Before -> today
            is Moment.After -> moment.next
            is Moment.NoLessons -> moment.next
        }
        if (day == null) {
            views.setTextViewText(R.id.tc_day_title, "Уроки на день")
            views.setTextViewText(
                R.id.tc_day_empty,
                if (plan.endsSoon(now)) Words.REFRESH else "Следующих уроков пока нет",
            )
            return views
        }
        val isToday = day === today
        views.setTextViewText(R.id.tc_day_title, if (isToday) "Сегодня" else Words.whenDay(day, now))
        views.setTextViewText(
            R.id.tc_day_meta,
            Words.date(day).replaceFirstChar { it.lowercase() },
        )
        val notice = when {
            day.short -> "Сокращённые уроки"
            !isToday && today != null && today.off.isNotBlank() -> today.off
            else -> ""
        }
        if (notice.isNotEmpty()) {
            views.setTextViewText(R.id.tc_day_notice, notice)
            views.setViewVisibility(R.id.tc_day_notice, View.VISIBLE)
        }
        views.setViewVisibility(R.id.tc_day_empty, View.GONE)
        // Не влезают все — первыми уступают место прошедшие уроки.
        val fit = capacity(height, notice.isNotEmpty())
        val finished = if (isToday) day.lessons.count { now >= it.end } else 0
        val shown = day.lessons.drop(minOf(finished, maxOf(0, day.lessons.size - fit))).take(fit)
        val text = ContextCompat.getColor(context, R.color.tc_text)
        val muted = ContextCompat.getColor(context, R.color.tc_muted)
        val accent = ContextCompat.getColor(context, R.color.tc_accent)
        shown.forEachIndexed { i, l ->
            val row = id(context, "tc_r$i")
            val past = isToday && now >= l.end
            val current = isToday && !past && now >= l.start
            views.setViewVisibility(row, View.VISIBLE)
            views.setInt(
                row,
                "setBackgroundResource",
                if (current) R.drawable.tc_row_current else R.drawable.tc_row_plain,
            )
            val bar = id(context, "tc_r${i}_bar")
            if (l.color != null) {
                views.setInt(bar, "setColorFilter", l.color)
                // Прошедший урок — бледная полоска, как и его текст.
                views.setInt(bar, "setImageAlpha", if (past) 90 else 255)
                views.setViewVisibility(bar, View.VISIBLE)
            } else {
                views.setViewVisibility(bar, View.INVISIBLE)
            }
            views.setTextViewText(id(context, "tc_r${i}_num"), l.number.toString())
            views.setTextViewText(id(context, "tc_r${i}_class"), l.className)
            views.setTextColor(id(context, "tc_r${i}_class"), if (past) muted else text)
            val detail = listOfNotNull(
                l.subject.takeIf { it.isNotBlank() },
                l.room.takeIf { it.isNotBlank() }?.let { "каб. $it" },
            ).joinToString(" · ") + if (l.note.isNotBlank()) "  ✎" else ""
            views.setTextViewText(id(context, "tc_r${i}_detail"), detail)
            // Начало урока; у идущего — когда звонок. Так остаётся место для предмета.
            views.setTextViewText(
                id(context, "tc_r${i}_time"),
                if (current) "до ${l.endText}" else l.startText,
            )
            views.setTextColor(
                id(context, "tc_r${i}_time"),
                when {
                    current -> accent
                    past -> muted
                    else -> text
                },
            )
        }
        return views
    }
}
