import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'alarm_service.dart';
import 'app_state.dart';

/// Push nhận khi app chạy nền/đã đóng: hệ thống đã phát còi theo kênh cảnh báo,
/// chỉ cần ghi lại thời điểm để app không kêu lặp khi người dùng mở lên.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  if (message.notification != null) await AlarmService.markRung();
}

/// Nhận thông báo cảnh báo (FCM) do DSS Engine phát khi dự báo PM2.5 vượt QCVN 05:2023.
class NotificationService {
  NotificationService._();

  /// Dùng để hiện thông báo trong ứng dụng khi app đang mở (FCM không tự hiện ở foreground)
  static final GlobalKey<ScaffoldMessengerState> messengerKey = GlobalKey<ScaffoldMessengerState>();

  static bool _ready = false;
  static String? _token;

  static bool get isReady => _ready;

  static Future<void> init() async {
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      _ready = true;
      _token = await getToken();

      // App đang mở: phát còi + thông báo trên kênh cảnh báo, banner trong app, làm mới trạng thái
      FirebaseMessaging.onMessage.listen((message) async {
        final n = message.notification;
        if (n != null) {
          final title = n.title ?? 'Cảnh báo AirHCM';
          final body = n.body ?? '';
          final rang = await AlarmService.trigger(title: title, body: body);
          if (!rang) showInAppBanner(title, body); // Đã kêu gần đây / tắt tiếng: vẫn hiện banner
        }
        AppState.refreshShared();
      });

      // Người dùng chạm vào thông báo -> mở tab Cảnh báo
      FirebaseMessaging.onMessageOpenedApp.listen((_) {
        AlarmService.markRung();
        AppState.tabIndex.value = 3;
      });
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        await AlarmService.markRung();
        AppState.tabIndex.value = 3;
      }
    } catch (e) {
      debugPrint('Không khởi tạo được FCM: $e');
    }
  }

  /// Banner đỏ trong ứng dụng kèm nút XEM -> tab Cảnh báo
  static void showInAppBanner(String title, String body) {
    final messenger = messengerKey.currentState;
    if (messenger == null) return;
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xFFB91C1C),
      duration: const Duration(seconds: 8),
      content: Row(
        children: [
          const Icon(Icons.warning_amber_rounded, color: Colors.white),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
                if (body.isNotEmpty) Text(body, style: const TextStyle(fontSize: 12.5)),
              ],
            ),
          ),
        ],
      ),
      action: SnackBarAction(label: 'XEM', textColor: Colors.white, onPressed: () => AppState.tabIndex.value = 3),
    ));
  }

  /// Token thiết bị để Backend gửi Push (null nếu thiết bị/Firebase chưa sẵn sàng)
  static Future<String?> getToken() async {
    if (!_ready) return null;
    try {
      // ignore: deprecated_member_use
      _token ??= await FirebaseMessaging.instance.getToken();
    } catch (e) {
      debugPrint('Không lấy được FCM token: $e');
    }
    return _token;
  }
}
