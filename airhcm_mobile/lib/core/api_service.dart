import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_config.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}

/// Lớp gọi API Backend AirHCM - đồng bộ 1:1 với các endpoint WebGIS đang dùng.
class ApiService {
  ApiService._();

  static const Duration _defaultTimeout = Duration(seconds: 15);

  static Future<dynamic> _get(String path, {Map<String, String>? query, Duration? timeout}) async {
    try {
      final res = await http.get(ApiConfig.uri(path, query)).timeout(timeout ?? _defaultTimeout);
      return _decode(res);
    } on TimeoutException {
      throw ApiException('Máy chủ phản hồi quá lâu. Kiểm tra kết nối tới ${ApiConfig.server}');
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('Không kết nối được máy chủ ${ApiConfig.server}');
    }
  }

  static Future<dynamic> _send(String method, String path, Map<String, dynamic> body,
      {Duration? timeout, Map<String, String>? headers}) async {
    try {
      final request = http.Request(method, ApiConfig.uri(path))
        ..headers['Content-Type'] = 'application/json'
        ..headers.addAll(headers ?? const {})
        ..body = jsonEncode(body);
      final streamed = await request.send().timeout(timeout ?? _defaultTimeout);
      final res = await http.Response.fromStream(streamed);
      return _decode(res);
    } on TimeoutException {
      throw ApiException('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('Không kết nối được máy chủ ${ApiConfig.server}');
    }
  }

  static dynamic _decode(http.Response res) {
    dynamic data;
    try {
      data = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;

    // FastAPI trả lỗi dạng {"detail": "..."} hoặc danh sách lỗi kiểm tra dữ liệu
    String message = 'Lỗi máy chủ (${res.statusCode})';
    if (data is Map && data['detail'] != null) {
      final detail = data['detail'];
      if (detail is String) {
        message = detail;
      } else if (detail is List && detail.isNotEmpty && detail.first is Map) {
        message = (detail.first as Map)['msg']?.toString() ?? message;
      }
    }
    throw ApiException(message, statusCode: res.statusCode);
  }

  static Map<String, dynamic> _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
  static List<dynamic> _list(dynamic v) => v is List ? v : const [];

  // ---------------------------------------------------------------------------
  // QUAN TRẮC & KHÔNG GIAN
  // ---------------------------------------------------------------------------
  static Future<Map<String, dynamic>> currentAqi() async => _map(await _get('/aqi/current'));

  static Future<List<dynamic>> stations() async => _list(await _get('/gis/stations'));

  static Future<List<dynamic>> spatialSummary() async => _list(await _get('/aqi/spatial-summary'));

  static Future<Map<String, dynamic>> heatmap() async => _map(await _get('/gis/heatmap'));

  /// Trường gió 10m & nhiệt độ 2m theo giờ (48h) - lưới TP.HCM + lưới khu vực (giống WebGIS)
  static Future<Map<String, dynamic>> windField() async =>
      _map(await _get('/weather/wind-field', timeout: const Duration(seconds: 45)));

  /// Sequence Diagram: gửi tọa độ -> Backend (PostGIS + AI Engine) -> JSON tổng hợp
  static Future<Map<String, dynamic>> locationInsight(double lat, double lng) async => _map(await _get(
        '/gis/location-insight',
        query: {'lat': lat.toStringAsFixed(6), 'lng': lng.toStringAsFixed(6)},
        timeout: const Duration(seconds: 30),
      ));

  // ---------------------------------------------------------------------------
  // DỰ BÁO AI & CẢNH BÁO DSS
  // ---------------------------------------------------------------------------
  /// Dự báo realtime đa chất (AirData): hôm nay + 7 ngày tới + xu hướng tháng.
  /// Ưu tiên mã phường; không có thì theo tọa độ; bỏ trống cả hai -> cấp TP.
  static Future<Map<String, dynamic>> airForecast({String? wardCode, double? lat, double? lng}) async {
    final q = <String, String>{};
    if (wardCode != null && wardCode.isNotEmpty) {
      q['ward_code'] = wardCode;
    } else if (lat != null && lng != null) {
      q['lat'] = lat.toStringAsFixed(6);
      q['lng'] = lng.toStringAsFixed(6);
    }
    return _map(await _get('/air/forecast', query: q.isEmpty ? null : q, timeout: const Duration(seconds: 40)));
  }

  /// Kết quả huấn luyện/kiểm thử mô hình (metrics.json)
  static Future<Map<String, dynamic>> airModelMetrics() async =>
      _map(await _get('/air/model-metrics', timeout: const Duration(seconds: 20)));

  static Future<List<dynamic>> forecast(int hours) async =>
      _list(await _get('/forecast/hourly', query: {'hours': '$hours'}, timeout: const Duration(seconds: 30)));

  static Future<Map<String, dynamic>> activeAlert() async =>
      _map(await _get('/alerts/active', timeout: const Duration(seconds: 30)));

  static Future<List<dynamic>> alertHistory({int limit = 10}) async =>
      _list(await _get('/alerts/history', query: {'limit': '$limit'}));

  /// Trợ lý AI: hỏi đáp dựa trên số liệu quan trắc, dự báo 24h và cảnh báo hiện hành
  static Future<Map<String, dynamic>> askAdvisor({
    required String question,
    double? lat,
    double? lng,
    String userGroup = 'normal',
    List<Map<String, String>> history = const [],
    bool useUSAQI = false,
  }) async {
    final data = _map(await _send('POST', '/dss/advice', {
      'user_query': question,
      'lat': ?lat,
      'lng': ?lng,
      'user_group': userGroup,
      'history': history,
      // AI nêu chỉ số theo đúng chuẩn người dùng đang chọn (VN_AQI / US AQI)
      'aqi_standard': useUSAQI ? 'US' : 'VN',
    }, timeout: const Duration(seconds: 45)));
    if (data['status'] != 'success') {
      throw ApiException(data['message']?.toString() ?? 'Trợ lý AI chưa thể trả lời.');
    }
    return _map(data['data']);
  }

  // ---------------------------------------------------------------------------
  // TIN TỨC
  // ---------------------------------------------------------------------------
  static Future<List<dynamic>> news() async => _list(await _get('/news', timeout: const Duration(seconds: 20)));

  // ---------------------------------------------------------------------------
  // TÀI KHOẢN (DÙNG CHUNG VỚI WEBGIS & TRANG QUẢN TRỊ)
  // ---------------------------------------------------------------------------
  /// Tài khoản + token phiên (token dùng để thành viên sửa hồ sơ của chính mình, VD khu vực theo dõi)
  static Map<String, dynamic> _withSession(dynamic res) {
    final data = _map(res);
    final user = _map(data['user']);
    if (data['token'] is String) {
      user['token'] = data['token'];
      user['token_expires_at'] = data['expires_at'];
    }
    return user;
  }

  static Future<Map<String, dynamic>> login(String email, String password) async =>
      _withSession(await _send('POST', '/auth/user/login', {'email': email, 'password': password}));

  /// Đăng nhập / đăng ký bằng Google, Facebook, Apple: Backend xác minh Firebase ID token
  /// (cùng endpoint với WebGIS) rồi trả về tài khoản thành viên AirHCM
  static Future<Map<String, dynamic>> socialLogin(String idToken, {String? fullname}) async =>
      _withSession(await _send('POST', '/auth/user/social', {
        'id_token': idToken,
        'fullname': ?fullname,
      }, timeout: const Duration(seconds: 30)));

  static Future<Map<String, dynamic>> register(String fullname, String email, String password) async =>
      _withSession(await _send('POST', '/auth/user/register', {
        'fullname': fullname,
        'email': email,
        'password': password,
      }));

  /// Phương thức đăng nhập đang dùng được: {'facebook': {'available': false, 'reason': '...'}, ...}
  static Future<Map<String, dynamic>> authProviders() async =>
      _map(await _get('/auth/providers', timeout: const Duration(seconds: 10)));

  /// Lưu khu vực theo dõi (nơi sinh sống / nơi làm việc) lên tài khoản - trả về tài khoản đã cập nhật
  static Future<Map<String, dynamic>> updateAreas(String token, {String? homeCode, String? workCode}) async =>
      _map(_map(await _send('PUT', '/auth/user/areas', {
        'home_ward_code': homeCode,
        'work_ward_code': workCode,
      }, headers: {'Authorization': 'Bearer $token'}))['user']);

  // ---------------------------------------------------------------------------
  // ĐĂNG KÝ NHẬN CẢNH BÁO
  // ---------------------------------------------------------------------------
  static Future<Map<String, dynamic>> subscribe({
    required String fullname,
    required String email,
    String phone = '',
    required String wardCode,
    required int thresholdAqi,
    String? fcmToken,
  }) async =>
      _map(await _send('POST', '/subscribe', {
        'fullname': fullname,
        'email': email,
        'phone': phone,
        'ward_code': wardCode,
        'threshold_aqi': thresholdAqi,
        'fcm_token': ?fcmToken,
      }));
}
