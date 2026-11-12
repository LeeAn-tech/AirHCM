import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'alarm_service.dart';
import 'api_service.dart';

/// Trạng thái dùng chung giữa các màn hình (đồng bộ với WebGIS):
/// chuẩn AQI đang chọn, số liệu quan trắc hiện tại, cảnh báo DSS, tài khoản, vị trí đã phân tích.
class AppState {
  AppState._();

  static const _prefStandard = 'aqi_standard_us';
  static const _prefUser = 'user_session';

  /// false: VN_AQI (QĐ 1459/QĐ-TCMT), true: US AQI (EPA)
  static final ValueNotifier<bool> useUSAQI = ValueNotifier(false);

  /// Số liệu /aqi/current
  static final ValueNotifier<Map<String, dynamic>?> current = ValueNotifier(null);

  /// Trạng thái cảnh báo /alerts/active (WARNING | NORMAL)
  static final ValueNotifier<Map<String, dynamic>?> alert = ValueNotifier(null);

  /// Tài khoản thành viên (cùng hệ thống tài khoản với WebGIS)
  static final ValueNotifier<Map<String, dynamic>?> user = ValueNotifier(null);

  /// Tab đang mở ở thanh điều hướng
  static final ValueNotifier<int> tabIndex = ValueNotifier(0);

  /// Câu hỏi chuyển sang Trợ lý AI (VD: từ màn hình phân tích vị trí)
  static final ValueNotifier<String?> pendingQuestion = ValueNotifier(null);

  /// Vị trí người dùng gần nhất (GPS hoặc nhấn giữ trên bản đồ) và tên phường
  static final ValueNotifier<LatLng?> lastLocation = ValueNotifier(null);
  static String? lastWardName;

  static Timer? _refreshTimer;

  static Future<void> loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    useUSAQI.value = prefs.getBool(_prefStandard) ?? false;
    final raw = prefs.getString(_prefUser);
    if (raw != null) {
      try {
        user.value = Map<String, dynamic>.from(jsonDecode(raw));
      } catch (_) {
        await prefs.remove(_prefUser);
      }
    }
    useUSAQI.addListener(() async {
      final p = await SharedPreferences.getInstance();
      await p.setBool(_prefStandard, useUSAQI.value);
    });
  }

  static Future<void> saveUser(Map<String, dynamic> data) async {
    user.value = data;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefUser, jsonEncode(data));
  }

  static Future<void> logout() async {
    user.value = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefUser);
  }

  /// Làm mới số liệu quan trắc & cảnh báo dùng chung (gọi khi mở app và định kỳ 5 phút)
  static Future<void> refreshShared() async {
    try {
      current.value = await ApiService.currentAqi();
    } catch (e) {
      debugPrint('Không nạp được AQI hiện tại: $e');
    }
    try {
      alert.value = await ApiService.activeAlert();
      // Phát còi nếu cảnh báo vượt ngưỡng người dùng (kể cả khi chưa đăng ký Push)
      await AlarmService.evaluate(alert.value);
    } catch (e) {
      debugPrint('Không nạp được cảnh báo DSS: $e');
    }
  }

  static void startAutoRefresh() {
    _refreshTimer?.cancel();
    refreshShared();
    _refreshTimer = Timer.periodic(const Duration(minutes: 5), (_) => refreshShared());
  }

  static void askAssistant(String question) {
    pendingQuestion.value = question;
    tabIndex.value = 2;
  }
}
