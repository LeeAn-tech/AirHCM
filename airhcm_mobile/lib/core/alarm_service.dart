import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_state.dart';
import 'notification_service.dart';

/// Tiếng còi cảnh báo khi AQI dự báo vượt ngưỡng (Activity Diagram: Warning_NhayCam).
///
/// Ba đường nhận cảnh báo đều phát tiếng còi `res/raw/aqi_alarm.wav`:
/// - Push FCM khi app chạy nền: hệ thống tự phát theo kênh [channelId] (Backend gửi kèm channel_id).
/// - Push FCM khi app đang mở: [trigger] hiện thông báo cục bộ trên cùng kênh + banner trong app.
/// - Không có Push (chưa đăng ký / Firebase lỗi): [evaluate] đối chiếu /alerts/active mỗi lần làm mới.
/// Chống làm phiền: tối đa 1 lần mỗi [cooldown] (giống thời gian nghỉ Push của Backend).
class AlarmService {
  AlarmService._();

  /// Phải trùng FCM_ALERT_CHANNEL_ID ở backend/app/services/alert_service.py
  static const String channelId = 'airhcm_aqi_alert_v1';
  static const String _channelName = 'Cảnh báo AQI vượt ngưỡng';
  static const String _channelDesc = 'Phát tiếng còi khi AI dự báo bụi mịn PM2.5 vượt QCVN 05:2023 / ngưỡng AQI bạn chọn';
  static const String _sound = 'aqi_alarm';
  static const String _icon = '@drawable/ic_stat_aqi';
  static const Duration cooldown = Duration(hours: 3);

  static const _prefEnabled = 'alert_sound_enabled';
  static const _prefThreshold = 'alert_threshold_aqi';
  static const _prefLastRung = 'alert_sound_last_time';

  static final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

  /// Bật/tắt tiếng còi (lưu trong máy)
  static final ValueNotifier<bool> enabled = ValueNotifier(true);

  /// Ngưỡng US AQI kích hoạt còi - cùng ngưỡng đã đăng ký nhận Push
  static final ValueNotifier<int> threshold = ValueNotifier(100);

  /// Thời điểm phát còi gần nhất (hiển thị ở tab Cảnh báo)
  static final ValueNotifier<DateTime?> lastRung = ValueNotifier(null);

  static bool _ready = false;
  static bool _busy = false;
  static int _nextId = 7100;

  static final Int64List _vibration = Int64List.fromList([0, 700, 250, 700, 250, 1000]);

  static bool get isReady => _ready;

  static Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    enabled.value = prefs.getBool(_prefEnabled) ?? true;
    threshold.value = prefs.getInt(_prefThreshold) ?? 100;
    lastRung.value = DateTime.tryParse(prefs.getString(_prefLastRung) ?? '');
    if (kIsWeb) return;

    try {
      await _plugin.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings(_icon),
          iOS: DarwinInitializationSettings(),
        ),
        // Chạm vào thông báo -> mở tab Cảnh báo
        onDidReceiveNotificationResponse: (_) => AppState.tabIndex.value = 3,
      );

      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(AndroidNotificationChannel(
        channelId,
        _channelName,
        description: _channelDesc,
        importance: Importance.max,
        sound: const RawResourceAndroidNotificationSound(_sound),
        vibrationPattern: _vibration,
        enableLights: true,
        ledColor: const Color(0xFFDC2626),
        audioAttributesUsage: AudioAttributesUsage.alarm,
      ));
      await android?.requestNotificationsPermission();
      _ready = true;

      final launch = await _plugin.getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp ?? false) AppState.tabIndex.value = 3;
    } catch (e) {
      debugPrint('Không khởi tạo được thông báo cục bộ: $e');
    }
  }

  static Future<void> setEnabled(bool value) async {
    enabled.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefEnabled, value);
  }

  static Future<void> setThreshold(int value) async {
    threshold.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_prefThreshold, value);
  }

  /// Ghi nhận đã báo (VD: hệ thống vừa phát Push nền) để không kêu lặp khi mở app
  static Future<void> markRung() async {
    final now = DateTime.now();
    lastRung.value = now;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefLastRung, now.toIso8601String());
  }

  /// Đối chiếu trạng thái /alerts/active với ngưỡng người dùng (gọi sau mỗi lần làm mới)
  static Future<void> evaluate(Map<String, dynamic>? alert) async {
    if (alert == null || alert['status'] != 'WARNING') return;
    final peakAqi = (alert['peak_aqi'] as num?)?.round() ?? 0;
    if (peakAqi < threshold.value) return;
    final peakPm = alert['peak_pm25'];
    final when = '${alert['peak_label'] ?? ''}'.trim();
    await trigger(
      title: '${alert['title'] ?? '⚠️ Cảnh báo bụi mịn PM2.5 vượt QCVN 05:2023'}',
      body: 'AI dự báo PM2.5 đạt $peakPm µg/m³ (US AQI $peakAqi)${when.isEmpty ? '' : ' lúc $when'}. '
          'Hạn chế ra ngoài, đeo khẩu trang N95. Chạm để xem khuyến cáo.',
    );
  }

  /// Phát còi + thông báo. Trả về false nếu đang tắt tiếng hoặc còn trong thời gian nghỉ.
  static Future<bool> trigger({required String title, required String body, bool force = false}) async {
    if ((!enabled.value && !force) || _busy) return false;
    _busy = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload(); // Push nền ghi từ isolate khác
      final last = DateTime.tryParse(prefs.getString(_prefLastRung) ?? '');
      final now = DateTime.now();
      if (!force && last != null && now.difference(last) < cooldown) return false;

      if (!force) await markRung();
      await _show(title, body);
      NotificationService.showInAppBanner(title, body);
      return true;
    } finally {
      _busy = false;
    }
  }

  /// Nghe thử tiếng còi (bỏ qua công tắc & thời gian nghỉ).
  /// Trả về false nếu người dùng chưa cho phép AirHCM gửi thông báo.
  static Future<bool> test() async {
    if (!_ready) return false;
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      final allowed = await android.areNotificationsEnabled() ?? true;
      if (!allowed) {
        await android.requestNotificationsPermission();
        if (!(await android.areNotificationsEnabled() ?? false)) return false;
      }
    }
    return trigger(
      title: '🔔 Thử tiếng cảnh báo AirHCM',
      body: 'Đây là âm thanh bạn sẽ nghe khi AI dự báo AQI vượt ngưỡng ${threshold.value}.',
      force: true,
    );
  }

  static Future<void> _show(String title, String body) async {
    if (!_ready) return;
    try {
      await _plugin.show(
        _nextId++,
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            channelId,
            _channelName,
            channelDescription: _channelDesc,
            icon: _icon,
            importance: Importance.max,
            priority: Priority.max,
            sound: const RawResourceAndroidNotificationSound(_sound),
            vibrationPattern: _vibration,
            audioAttributesUsage: AudioAttributesUsage.alarm,
            category: AndroidNotificationCategory.alarm,
            color: const Color(0xFFDC2626),
            ticker: title,
            styleInformation: BigTextStyleInformation(body),
          ),
          iOS: const DarwinNotificationDetails(presentAlert: true, presentSound: true, presentBanner: true),
        ),
      );
    } catch (e) {
      debugPrint('Không hiện được thông báo cảnh báo: $e');
    }
  }
}
