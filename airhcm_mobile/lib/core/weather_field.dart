import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

import 'api_service.dart';
import 'app_state.dart';
import 'aqi_utils.dart';

/// Một lưới dữ liệu khí tượng đều (u, v, temp theo giờ) từ /weather/wind-field
class _Grid {
  final double lat0, lng0, dlat, dlng;
  final int ny, nx;
  final List<String> times;
  final Map<String, List<List<double?>>> layers;

  _Grid(this.lat0, this.lng0, this.dlat, this.dlng, this.ny, this.nx, this.times, this.layers);

  static _Grid? parse(dynamic raw) {
    if (raw is! Map) return null;
    List<List<double?>> layer(dynamic v) => v is List
        ? v.map((row) => row is List ? row.map((x) => x is num ? x.toDouble() : null).toList() : <double?>[]).toList()
        : <List<double?>>[];
    final ny = (raw['ny'] as num?)?.toInt() ?? 0, nx = (raw['nx'] as num?)?.toInt() ?? 0;
    if (ny < 2 || nx < 2) return null;
    return _Grid(
      AqiUtils.toDouble(raw['lat0']),
      AqiUtils.toDouble(raw['lng0']),
      AqiUtils.toDouble(raw['dlat'], 1),
      AqiUtils.toDouble(raw['dlng'], 1),
      ny,
      nx,
      (raw['times'] as List? ?? const []).map((e) => '$e').toList(),
      {'u': layer(raw['u']), 'v': layer(raw['v']), 'temp': layer(raw['temp'])},
    );
  }

  double get south => lat0;
  double get north => lat0 + (ny - 1) * dlat;
  double get west => lng0;
  double get east => lng0 + (nx - 1) * dlng;

  /// Nội suy song tuyến; ngoài lưới lấy giá trị biên gần nhất (giống sampleGrid của WebGIS)
  double sample(String name, double lat, double lng, int t) {
    final arr = layers[name];
    if (arr == null || t < 0 || t >= arr.length || arr[t].length < ny * nx) return double.nan;
    final fi = ((lat - lat0) / dlat).clamp(0.0, ny - 1.0);
    final fj = ((lng - lng0) / dlng).clamp(0.0, nx - 1.0);
    final i0 = fi.floor(), j0 = fj.floor();
    final i1 = math.min(i0 + 1, ny - 1), j1 = math.min(j0 + 1, nx - 1);
    final di = fi - i0, dj = fj - j0;
    final a = arr[t][i0 * nx + j0], b = arr[t][i0 * nx + j1];
    final c = arr[t][i1 * nx + j0], d = arr[t][i1 * nx + j1];
    if (a == null || b == null || c == null || d == null) return double.nan;
    return a * (1 - di) * (1 - dj) + b * (1 - di) * dj + c * di * (1 - dj) + d * di * dj;
  }
}

/// Gió tại một điểm: tốc độ (m/s) và hướng gió thổi từ
class WindInfo {
  final double speed;
  final String direction;
  const WindInfo(this.speed, this.direction);
}

/// Nhiệt độ & gió theo tọa độ và giờ mô phỏng - cùng nguồn Open-Meteo và cách nội suy với popup WebGIS.
class WeatherField {
  WeatherField._();

  /// Chu kỳ nhiệt độ ngày đêm TP.HCM (ERA5) - dự phòng khi chưa có lưới (giống HOURLY_TEMP_ERA5)
  static const List<double> _tempEra5 = [
    25.8, 25.4, 25.1, 24.8, 24.6, 25.0, 26.2, 27.8, 29.5, 31.2, 32.8, 34.0,
    34.8, 35.2, 34.6, 33.5, 31.8, 30.2, 28.9, 28.0, 27.4, 26.9, 26.4, 26.0,
  ];

  /// Dải pha trộn (độ) sát biên lưới chi tiết để không có đường nối với lưới khu vực
  static const double _blendDeg = 0.3;

  static _Grid? _fine;
  static _Grid? _region;
  static DateTime? _loadedAt;
  static Future<void>? _pending;

  /// Đổi khi nạp xong dữ liệu để giao diện vẽ lại
  static final ValueNotifier<int> version = ValueNotifier(0);

  static bool get hasData => _fine != null;

  /// Nạp lưới (bộ nhớ đệm 1 giờ; backend tự làm mới 3 giờ/lần)
  static Future<void> ensureLoaded() {
    final fresh = _loadedAt != null && DateTime.now().difference(_loadedAt!) < const Duration(hours: 1);
    if (fresh) return Future.value();
    return _pending ??= _load().whenComplete(() => _pending = null);
  }

  static Future<void> _load() async {
    try {
      final data = await ApiService.windField();
      final fine = _Grid.parse(data);
      if (fine == null) return;
      _fine = fine;
      _region = _Grid.parse(data['regional']);
      _loadedAt = DateTime.now();
      version.value++;
    } catch (e) {
      debugPrint('Không nạp được trường gió/nhiệt độ: $e');
    }
  }

  /// Mốc giờ trong dữ liệu ứng với giờ mô phỏng (trong 24h tới tính từ hiện tại)
  static int _timeIndex(int hour) {
    final f = _fine;
    if (f == null) return -1;
    final now = DateTime.now();
    var target = DateTime(now.year, now.month, now.day, hour);
    if (hour < now.hour) target = target.add(const Duration(days: 1));
    String two(int n) => n.toString().padLeft(2, '0');
    final key = '${target.year}-${two(target.month)}-${two(target.day)}T${two(hour)}:00';
    final idx = f.times.indexOf(key);
    if (idx >= 0) return idx;
    return f.times.indexWhere((t) => t.endsWith('T${two(hour)}:00'));
  }

  static double _sample(String name, double lat, double lng, int t) {
    final fine = _fine;
    if (fine == null) return double.nan;
    final region = _region;
    final inside = [lat - fine.south, fine.north - lat, lng - fine.west, fine.east - lng].reduce(math.min);
    if (region == null || inside >= _blendDeg) return fine.sample(name, lat, lng, t);
    final rv = region.sample(name, lat, lng, t);
    if (inside <= 0) return rv;
    final fv = fine.sample(name, lat, lng, t);
    if (fv.isNaN) return rv;
    if (rv.isNaN) return fv;
    final w = inside / _blendDeg;
    return fv * w + rv * (1 - w);
  }

  /// Nhiệt độ 2m (°C) tại điểm theo giờ mô phỏng
  static double temperature(LatLng p, int hour) {
    final t = _timeIndex(hour);
    if (t >= 0) {
      final v = _sample('temp', p.latitude, p.longitude, t);
      if (!v.isNaN) return v;
    }
    return _tempEra5[hour % 24];
  }

  /// Gió 10m tại điểm theo giờ mô phỏng (dự phòng: gió trạm trung tâm /aqi/current)
  static WindInfo wind(LatLng p, int hour) {
    final t = _timeIndex(hour);
    double u = double.nan, v = double.nan;
    if (t >= 0) {
      u = _sample('u', p.latitude, p.longitude, t);
      v = _sample('v', p.latitude, p.longitude, t);
    }
    if (u.isNaN || v.isNaN) {
      final cur = AppState.current.value;
      final speed = AqiUtils.toDouble(cur?['wind_speed'], 10) / 3.6; // km/h -> m/s
      final rad = AqiUtils.toDouble(cur?['wind_direction'], 150) * math.pi / 180;
      u = -speed * math.sin(rad);
      v = -speed * math.cos(rad);
    }
    return WindInfo(math.sqrt(u * u + v * v), directionName(u, v));
  }

  /// Hướng khí tượng (gió thổi TỪ hướng nào)
  static String directionName(double u, double v) {
    final from = (math.atan2(-u, -v) * 180 / math.pi + 360) % 360;
    const names = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
    return names[(from / 45).round() % 8];
  }
}
