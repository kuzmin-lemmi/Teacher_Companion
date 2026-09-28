package ru.teachercompanion.lessons

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Build
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
        val dayIds = ids(context, DayWidget::class.java)
        if (dayIds.isNotEmpty()) manager.updateAppWidget(dayIds, dayViews(context, plan, now))
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
        when (val moment = Moment.of(plan, now)) {
            is Moment.During -> {
                val l = moment.lesson
                views.setTextViewText(R.id.tc_now_title, l.title)
                val next = moment.next?.let { "далее ${it.className} в ${it.startText}" }
                    ?: "последний урок"
                views.setTextViewText(R.id.tc_now_detail, "${l.number}-й урок до ${l.endText} · $next")
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
                views.setTextViewText(R.id.tc_now_detail, Words.nextDay(moment.next, now))
            }
            is Moment.NoLessons -> {
                val off = moment.day?.off?.takeIf { it.isNotBlank() }
                views.setTextViewText(R.id.tc_now_title, off ?: "Сегодня уроков нет")
                views.setTextViewText(R.id.tc_now_detail, Words.nextDay(moment.next, now))
            }
        }
        return views
    }

    private fun id(context: Context, name: String) =
        context.resources.getIdentifier(name, "id", context.packageName)

    private fun dayViews(context: Context, plan: Plan?, now: Long): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.tc_widget_day)
        Scheduler.openApp(context, 2)?.let { views.setOnClickPendingIntent(R.id.tc_root, it) }
        if (plan == null) return views
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
            views.setTextViewText(R.id.tc_day_empty, "Следующих уроков пока нет")
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
        val muted = ContextCompat.getColor(context, R.color.tc_muted)
        val accent = ContextCompat.getColor(context, R.color.tc_accent)
        day.lessons.take(ROWS).forEachIndexed { i, l ->
            val row = id(context, "tc_r$i")
            views.setViewVisibility(row, View.VISIBLE)
            views.setTextViewText(id(context, "tc_r${i}_num"), l.number.toString())
            views.setTextViewText(id(context, "tc_r${i}_class"), l.className)
            val detail = listOfNotNull(
                l.subject.takeIf { it.isNotBlank() },
                l.room.takeIf { it.isNotBlank() }?.let { "каб. $it" },
            ).joinToString(" · ") + if (l.note.isNotBlank()) "  ✎" else ""
            views.setTextViewText(id(context, "tc_r${i}_detail"), detail)
            views.setTextViewText(id(context, "tc_r${i}_time"), "${l.startText}–${l.endText}")
            if (isToday && now >= l.end) {
                for (part in listOf("class", "time"))
                    views.setTextColor(id(context, "tc_r${i}_$part"), muted)
            } else if (isToday && now >= l.start) {
                views.setInt(row, "setBackgroundResource", R.drawable.tc_row_current)
                views.setTextColor(id(context, "tc_r${i}_time"), accent)
            }
        }
        return views
    }
}
