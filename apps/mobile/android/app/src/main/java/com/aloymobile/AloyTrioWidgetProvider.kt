package com.aloymobile

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

class AloyTrioWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
            val views = RemoteViews(context.packageName, R.layout.widget_aloy_trio)
            applyClickIntents(context, views)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        fun applyClickIntents(context: Context, views: RemoteViews) {
            views.setOnClickPendingIntent(R.id.trio_btn_voice, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://voice"))
            views.setOnClickPendingIntent(R.id.trio_btn_briefing, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://briefing"))
            views.setOnClickPendingIntent(R.id.trio_btn_lights, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://lights"))
            views.setOnClickPendingIntent(R.id.trio_btn_chat, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://chat"))
            views.setOnClickPendingIntent(R.id.trio_agenda_box, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://agenda"))
            views.setOnClickPendingIntent(R.id.trio_home_box, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://smarthome"))
            views.setOnClickPendingIntent(R.id.trio_portfolio_box, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://portfolio"))
            views.setOnClickPendingIntent(R.id.widget_trio_root, WidgetDeepLinks.getDeepLinkIntent(context, "aloy://open"))
        }
    }
}
