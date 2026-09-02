package com.aloymobile

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.widget.RemoteViews
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class WidgetBridgeModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WidgetBridge"

    @ReactMethod
    fun updateWidgetData(data: ReadableMap) {
        try {
            val appWidgetManager = AppWidgetManager.getInstance(reactContext)

            // Update Focus Bar (4x1)
            val focusComponent = ComponentName(reactContext, AloyFocusWidgetProvider::class.java)
            val focusIds = appWidgetManager.getAppWidgetIds(focusComponent)
            if (focusIds.isNotEmpty()) {
                val views = RemoteViews(reactContext.packageName, R.layout.widget_aloy_focus)
                AloyFocusWidgetProvider.applyClickIntents(reactContext, views)
                if (data.hasKey("statusText")) {
                    views.setTextViewText(R.id.widget_status_text, data.getString("statusText"))
                }
                appWidgetManager.updateAppWidget(focusIds, views)
            }

            // Update Bento Hub (4x2)
            val bentoComponent = ComponentName(reactContext, AloyBentoWidgetProvider::class.java)
            val bentoIds = appWidgetManager.getAppWidgetIds(bentoComponent)
            if (bentoIds.isNotEmpty()) {
                val views = RemoteViews(reactContext.packageName, R.layout.widget_aloy_bento)
                AloyBentoWidgetProvider.applyClickIntents(reactContext, views)
                if (data.hasKey("statusPill")) {
                    views.setTextViewText(R.id.bento_status_pill, data.getString("statusPill"))
                }
                if (data.hasKey("agendaText")) {
                    views.setTextViewText(R.id.bento_agenda_text, data.getString("agendaText"))
                }
                if (data.hasKey("homeText")) {
                    views.setTextViewText(R.id.bento_home_text, data.getString("homeText"))
                }
                appWidgetManager.updateAppWidget(bentoIds, views)
            }

            // Update Trio Hub (4x3)
            val trioComponent = ComponentName(reactContext, AloyTrioWidgetProvider::class.java)
            val trioIds = appWidgetManager.getAppWidgetIds(trioComponent)
            if (trioIds.isNotEmpty()) {
                val views = RemoteViews(reactContext.packageName, R.layout.widget_aloy_trio)
                AloyTrioWidgetProvider.applyClickIntents(reactContext, views)
                if (data.hasKey("statusPill")) {
                    views.setTextViewText(R.id.trio_status_pill, data.getString("statusPill"))
                }
                if (data.hasKey("agendaText")) {
                    views.setTextViewText(R.id.trio_agenda_text, data.getString("agendaText"))
                }
                if (data.hasKey("homeText")) {
                    views.setTextViewText(R.id.trio_home_text, data.getString("homeText"))
                }
                if (data.hasKey("portfolioText")) {
                    views.setTextViewText(R.id.trio_portfolio_text, data.getString("portfolioText"))
                }
                appWidgetManager.updateAppWidget(trioIds, views)
            }

            // Update Quad Hub (4x4)
            val quadComponent = ComponentName(reactContext, AloyQuadWidgetProvider::class.java)
            val quadIds = appWidgetManager.getAppWidgetIds(quadComponent)
            if (quadIds.isNotEmpty()) {
                val views = RemoteViews(reactContext.packageName, R.layout.widget_aloy_quad)
                AloyQuadWidgetProvider.applyClickIntents(reactContext, views)
                if (data.hasKey("statusPill")) {
                    views.setTextViewText(R.id.quad_status_pill, data.getString("statusPill"))
                }
                if (data.hasKey("agendaText")) {
                    views.setTextViewText(R.id.quad_agenda_text, data.getString("agendaText"))
                }
                if (data.hasKey("homeText")) {
                    views.setTextViewText(R.id.quad_home_text, data.getString("homeText"))
                }
                if (data.hasKey("portfolioText")) {
                    views.setTextViewText(R.id.quad_portfolio_text, data.getString("portfolioText"))
                }
                if (data.hasKey("jobsText")) {
                    views.setTextViewText(R.id.quad_jobs_text, data.getString("jobsText"))
                }
                appWidgetManager.updateAppWidget(quadIds, views)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
