import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:latlong2/latlong.dart';

/// Ranh giới 1 phường/xã đọc từ GeoJSON (cùng file với WebGIS)
class WardShape {
  final String code;
  final String name;
  final String type;
  final List<List<LatLng>> rings;
  final LatLng center;

  const WardShape({
    required this.code,
    required this.name,
    required this.type,
    required this.rings,
    required this.center,
  });

  String get displayName => type.isNotEmpty && !name.startsWith(type) ? '$type $name' : name;

  /// Kiểm tra điểm có nằm trong phường (thuật toán ray casting trên các vòng ngoài)
  bool contains(LatLng p) {
    for (final ring in rings) {
      var inside = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        final xi = ring[i].longitude, yi = ring[i].latitude;
        final xj = ring[j].longitude, yj = ring[j].latitude;
        final intersect = ((yi > p.latitude) != (yj > p.latitude)) &&
            (p.longitude < (xj - xi) * (p.latitude - yi) / ((yj - yi) == 0 ? 1e-12 : (yj - yi)) + xi);
        if (intersect) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
}

/// Danh mục 168 phường/xã TP.HCM (nạp một lần, dùng cho bản đồ, tìm kiếm, đăng ký cảnh báo)
class WardCatalog {
  WardCatalog._();

  static List<WardShape>? _wards;
  static Future<List<WardShape>>? _loading;

  static Future<List<WardShape>> load() {
    if (_wards != null) return Future.value(_wards);
    return _loading ??= _parse();
  }

  static Future<List<WardShape>> _parse() async {
    final raw = await rootBundle.loadString('assets/data/hcm_wards.json');
    final data = jsonDecode(raw) as Map<String, dynamic>;
    final result = <WardShape>[];

    for (final f in (data['features'] as List? ?? const [])) {
      final props = Map<String, dynamic>.from(f['properties'] ?? {});
      final geom = f['geometry'];
      if (geom == null) continue;

      final rings = <List<LatLng>>[];
      List<LatLng> toRing(List coords) =>
          coords.map((c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble())).toList();

      if (geom['type'] == 'Polygon') {
        rings.add(toRing(geom['coordinates'][0] as List));
      } else if (geom['type'] == 'MultiPolygon') {
        for (final poly in geom['coordinates'] as List) {
          rings.add(toRing(poly[0] as List));
        }
      }
      if (rings.isEmpty || rings.first.isEmpty) continue;

      // Tâm hiển thị: trung bình đỉnh của vòng lớn nhất
      final main = rings.reduce((a, b) => a.length >= b.length ? a : b);
      final lat = main.fold<double>(0, (s, p) => s + p.latitude) / main.length;
      final lng = main.fold<double>(0, (s, p) => s + p.longitude) / main.length;

      result.add(WardShape(
        code: '${props['ma_xa'] ?? props['ma_phuong_xa'] ?? ''}',
        name: '${props['ten_xa'] ?? props['ten_phuong_xa'] ?? props['NAME_3'] ?? 'Phường/Xã'}',
        type: '${props['loai'] ?? props['loai_don_vi'] ?? ''}',
        rings: rings,
        center: LatLng(lat, lng),
      ));
    }
    result.sort((a, b) => a.name.compareTo(b.name));
    _wards = result;
    return result;
  }

  static WardShape? locate(LatLng p) {
    for (final w in _wards ?? const <WardShape>[]) {
      if (w.contains(p)) return w;
    }
    return null;
  }
}
