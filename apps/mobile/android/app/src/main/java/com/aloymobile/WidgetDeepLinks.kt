package com.aloymobile

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

// Shared by every AppWidgetProvider AND WidgetBridgeModule, so a live text
// update from JS (updateWidgetData) rebuilds the exact same click intents
// the provider's own onUpdate sets — RemoteViews.updateAppWidget() replaces
// the whole view tree, so a partial update that only calls
// setTextViewText() silently strips every button's PendingIntent until the
// next 30-min onUpdate tick.
object WidgetDeepLinks {
    fun getDeepLinkIntent(context: Context, uriString: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(uriString)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            uriString.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
