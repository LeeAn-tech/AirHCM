import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Cấu hình địa chỉ máy chủ Backend AirHCM (dùng chung với WebGIS).
///
/// Địa chỉ được lưu trong máy. Khi router cấp IP mới cho máy tính chạy Backend,
/// [ensureReachable] tự dò tìm máy chủ trong cùng mạng Wi-Fi (GET /api/v1/health)
/// và lưu lại địa chỉ mới - người dùng không phải nhập IP thủ công.
class ApiConfig {
  ApiConfig._();

  /// Mặc định: IP máy tính chạy backend trong mạng LAN (xem bằng lệnh `ipconfig`).
  /// Máy ảo Android dùng http://10.0.2.2:8000
  static const String defaultServer = 'http://192.168.1.86:8000';
  static const int defaultPort = 8000;
  static const String _prefKey = 'api_server_url';

  static String _server = defaultServer;

  /// Địa chỉ đang dùng - các màn hình lắng nghe để nạp lại dữ liệu khi máy chủ đổi
  static final ValueNotifier<String> serverNotifier = ValueNotifier(defaultServer);

  /// Đang dò tìm máy chủ trong mạng Wi-Fi
  static final ValueNotifier<bool> discovering = ValueNotifier(false);

  static Future<String?>? _discovery;

  static String get server => _server;
  static String get apiBase => '$_server/api/v1';

  static Uri uri(String path, [Map<String, String>? query]) {
    final base = Uri.parse('$apiBase$path');
    return query == null ? base : base.replace(queryParameters: query);
  }

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _server = normalize(prefs.getString(_prefKey) ?? defaultServer);
    serverNotifier.value = _server;
  }

  static Future<void> save(String url) async {
    _server = normalize(url);
    serverNotifier.value = _server;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefKey, _server);
  }

  /// Chuẩn hóa: thêm http://, bỏ dấu / cuối và hậu tố /api/v1 nếu người dùng nhập thừa
  static String normalize(String raw) {
    var s = raw.trim();
    if (s.isEmpty) return defaultServer;
    if (!s.startsWith('http://') && !s.startsWith('https://')) s = 'http://$s';
    while (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    if (s.endsWith('/api/v1')) s = s.substring(0, s.length - '/api/v1'.length);
    return s;
  }

  /// Địa chỉ có đúng là Backend AirHCM đang chạy không
  static Future<bool> ping(String server, {Duration timeout = const Duration(seconds: 3)}) async {
    final url = '${normalize(server)}/api/v1/health';
    if (kIsWeb) {
      try {
        final res = await http.get(Uri.parse(url)).timeout(timeout);
        return res.statusCode == 200 && res.body.contains('"AirHCM"');
      } catch (_) {
        return false;
      }
    }
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final req = await client.getUrl(Uri.parse(url)).timeout(timeout);
      final res = await req.close().timeout(timeout);
      if (res.statusCode != 200) return false;
      final body = await res.transform(utf8.decoder).join().timeout(timeout);
      return body.contains('"AirHCM"');
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  /// Bảo đảm có máy chủ dùng được: thử địa chỉ đã lưu, không được thì tự dò trong mạng Wi-Fi
  static Future<bool> ensureReachable() async {
    if (await ping(_server)) return true;
    return await discover() != null;
  }

  /// Quét dải mạng Wi-Fi của điện thoại (x.y.z.1-254) tìm Backend AirHCM, lưu & trả về địa chỉ tìm thấy
  static Future<String?> discover({void Function(int done, int total)? onProgress}) {
    if (kIsWeb) return Future.value(null);
    return _discovery ??= _discover(onProgress).whenComplete(() => _discovery = null);
  }

  static bool _isPrivate(String ip) {
    final p = ip.split('.').map(int.tryParse).toList();
    if (p.length != 4 || p.contains(null)) return false;
    return p[0] == 10 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && p[1]! >= 16 && p[1]! <= 31);
  }

  static Future<String?> _discover(void Function(int done, int total)? onProgress) async {
    discovering.value = true;
    try {
      final current = Uri.tryParse(_server);
      final port = current != null && current.hasPort ? current.port : defaultPort;
      final oldHost = current?.host ?? '';

      // Dải mạng của chính điện thoại (Wi-Fi / hotspot)
      final own = <String>{};
      final prefixes = <String>{};
      for (final iface in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
        for (final addr in iface.addresses) {
          if (!_isPrivate(addr.address)) continue;
          own.add(addr.address);
          prefixes.add(addr.address.substring(0, addr.address.lastIndexOf('.')));
        }
      }

      // Thứ tự quét: quanh số cuối của IP cũ trước (router thường cấp IP gần nhau)
      final candidates = <String>[];
      for (final prefix in prefixes) {
        final center = oldHost.startsWith('$prefix.') ? int.tryParse(oldHost.split('.').last) ?? 100 : 100;
        final hosts = List<int>.generate(254, (i) => i + 1)
          ..sort((a, b) => (a - center).abs().compareTo((b - center).abs()));
        for (final n in hosts) {
          final ip = '$prefix.$n';
          if (!own.contains(ip)) candidates.add('http://$ip:$port');
        }
      }
      candidates.add('http://10.0.2.2:$port'); // Máy ảo Android

      String? found;
      var next = 0, done = 0;
      Future<void> worker() async {
        while (found == null && next < candidates.length) {
          final candidate = candidates[next++];
          if (await ping(candidate, timeout: const Duration(milliseconds: 1500))) found ??= candidate;
          done++;
          onProgress?.call(done, candidates.length);
        }
      }

      await Future.wait(List.generate(48, (_) => worker()));
      if (found != null) {
        await save(found!);
        debugPrint('Đã tìm thấy máy chủ AirHCM: $found');
      }
      return found;
    } catch (e) {
      debugPrint('Không dò được máy chủ AirHCM: $e');
      return null;
    } finally {
      discovering.value = false;
    }
  }
}
