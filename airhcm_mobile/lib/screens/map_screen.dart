import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' hide Path;
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api_config.dart';
import '../core/api_service.dart';
import '../core/app_state.dart';
import '../core/aqi_utils.dart';
import '../core/location_service.dart';
import '../core/ward_catalog.dart';
import '../core/weather_field.dart';
import '../widgets/location_insight_sheet.dart';
import '../widgets/ui.dart';
import 'auth_screen.dart';

/// Bản đồ WebGIS di động - đồng bộ dữ liệu với WebGIS AirHCM:
/// trạm quan trắc PostGIS, chỉ số theo 166 phường, bản đồ nhiệt, mô phỏng 24h, cảnh báo DSS,
/// 4 lớp bản đồ nền như WebGIS, chạm vào bản đồ để xem nhanh AQI / PM2.5 / nhiệt độ / gió,
/// nhấn giữ để phân tích chi tiết theo tọa độ.
class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _Selection {
  final String title;
  final String subtitle;
  final double pmNow;
  final LatLng point;
  final IconData icon;
  const _Selection(this.title, this.subtitle, this.pmNow, this.point, this.icon);
}

class _HeatPoint {
  final LatLng point;
  final double pmNow;
  const _HeatPoint(this.point, this.pmNow);
}

/// Popup thông tin tại điểm chạm (giống popup phường của WebGIS)
class _MapPopup {
  final LatLng point;
  final String title;
  final String subtitle;
  final double pmNow;
  const _MapPopup(this.point, this.title, this.subtitle, this.pmNow);
}

/// Lớp bản đồ nền - cùng 4 lớp với bộ chọn "Bản đồ nền" của WebGIS
class _Basemap {
  final String id;
  final String label;
  final String url;
  final int maxNativeZoom;
  final String? labelsUrl;
  final String attribution;
  final Color fallback;
  const _Basemap(this.id, this.label, this.url, this.maxNativeZoom, this.attribution, this.fallback, {this.labelsUrl});

  /// Ô bản đồ z11 phủ trung tâm TP.HCM làm ảnh xem trước
  String get thumbnail => url.replaceAll('{z}', '11').replaceAll('{x}', '1631').replaceAll('{y}', '962');
}

class _MapScreenState extends State<MapScreen> with SingleTickerProviderStateMixin {
  static const LatLng _hcmCenter = LatLng(10.8231, 106.6297);
  static const _prefBasemap = 'map_basemap';

  static const List<_Basemap> _basemaps = [
    _Basemap('light', 'Sáng',
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        16, '© Esri, HERE, Garmin', Color(0xFFE5E7EB)),
    _Basemap('dark', 'Tối',
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        16, '© Esri', Color(0xFF374151)),
    _Basemap('osm', 'Đường phố', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', 19, '© OpenStreetMap contributors',
        Color(0xFFF2EFE9)),
    _Basemap('satellite', 'Vệ tinh',
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        18, '© Esri World Imagery', Color(0xFF1F2937),
        labelsUrl:
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'),
  ];

  // Kích thước popup (logic px): khung marker cao hơn thẻ để chứa chữ phóng to
  static const double _popupW = 288;
  static const double _popupBoxH = 420;
  static const double _popupCardH = 372;

  final MapController _mapController = MapController();
  final TextEditingController _searchCtrl = TextEditingController();
  late final AnimationController _camAnim = AnimationController(vsync: this, duration: const Duration(milliseconds: 480));
  VoidCallback? _camListener;

  List<WardShape> _wards = [];
  final Map<String, double> _wardPm = {};
  List<Map<String, dynamic>> _stations = [];
  final Map<String, double> _stationPm = {};
  List<_HeatPoint> _heat = [];
  bool _loading = true;
  bool _offline = false;

  bool _showStations = true;
  bool _showHeat = true;
  bool _showWards = true;
  String _basemapId = 'light';

  _Selection? _selection;
  WardShape? _highlight;
  LatLng? _pin;
  _MapPopup? _popup;
  bool _locating = false;

  int _hour = DateTime.now().hour;
  bool _playing = false;
  Timer? _playTimer;
  Timer? _refreshTimer;

  // Trạm dự phòng khi chưa kết nối được máy chủ
  static const List<Map<String, dynamic>> _fallbackStations = [
    {'ma_tram': 'HCM_OM_01', 'ten_tram': 'Trạm quan trắc trung tâm TP.HCM', 'lat': 10.8231, 'lng': 106.6297, 'status': 'HOẠT ĐỘNG'},
    {'ma_tram': 'HCM_Q1_02', 'ten_tram': 'Trạm Quan trắc Trung tâm Q.1', 'lat': 10.7769, 'lng': 106.7009, 'status': 'HOẠT ĐỘNG'},
    {'ma_tram': 'HCM_Q8_03', 'ten_tram': 'Trạm Quan trắc Bình Đông - Q.8', 'lat': 10.7328, 'lng': 106.6525, 'status': 'HOẠT ĐỘNG'},
    {'ma_tram': 'HCM_TD_04', 'ten_tram': 'Trạm Khu đô thị TP. Thủ Đức', 'lat': 10.8494, 'lng': 106.7583, 'status': 'HOẠT ĐỘNG'},
    {'ma_tram': 'HCM_BT_05', 'ten_tram': 'Trạm Cửa ngõ KCN Bình Tân', 'lat': 10.7483, 'lng': 106.6022, 'status': 'HOẠT ĐỘNG'},
    {'ma_tram': 'HCM_CC_06', 'ten_tram': 'Trạm Sinh thái Ngoại ô Củ Chi', 'lat': 10.9731, 'lng': 106.4952, 'status': 'HOẠT ĐỘNG'},
  ];

  @override
  void initState() {
    super.initState();
    AppState.current.addListener(_onSharedChanged);
    AppState.alert.addListener(_onSharedChanged);
    AppState.useUSAQI.addListener(_onSharedChanged);
    WeatherField.version.addListener(_onSharedChanged);
    ApiConfig.discovering.addListener(_onSharedChanged);
    ApiConfig.serverNotifier.addListener(_onServerChanged);
    _restoreBasemap();
    _init();
    _refreshTimer = Timer.periodic(const Duration(minutes: 5), (_) => _loadData());
  }

  @override
  void dispose() {
    AppState.current.removeListener(_onSharedChanged);
    AppState.alert.removeListener(_onSharedChanged);
    AppState.useUSAQI.removeListener(_onSharedChanged);
    WeatherField.version.removeListener(_onSharedChanged);
    ApiConfig.discovering.removeListener(_onSharedChanged);
    ApiConfig.serverNotifier.removeListener(_onServerChanged);
    _playTimer?.cancel();
    _refreshTimer?.cancel();
    _camAnim.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSharedChanged() {
    if (mounted) setState(() {});
  }

  /// Đổi máy chủ (người dùng lưu hoặc tự dò thấy IP mới) -> nạp lại toàn bộ dữ liệu bản đồ
  void _onServerChanged() {
    if (mounted) _loadData();
  }

  Future<void> _init() async {
    try {
      _wards = await WardCatalog.load();
    } catch (e) {
      debugPrint('Không đọc được ranh giới phường: $e');
    }
    await _loadData();
  }

  Future<T?> _safe<T>(Future<T> future) async {
    try {
      return await future;
    } catch (e) {
      debugPrint('API bản đồ: $e');
      return null;
    }
  }

  Future<void> _loadData() async {
    WeatherField.ensureLoaded(); // Nhiệt độ & gió cho popup (bộ nhớ đệm 1 giờ)
    final results = await Future.wait([
      _safe(ApiService.stations()),
      _safe(ApiService.spatialSummary()),
      _safe(ApiService.heatmap()),
    ]);
    if (!mounted) return;

    final stations = results[0] as List<dynamic>?;
    final summary = results[1] as List<dynamic>?;
    final heat = results[2] as Map<String, dynamic>?;

    final offline = stations == null && summary == null;
    // Mất kết nối (thường do router đổi IP máy tính) -> tự dò máy chủ trong mạng Wi-Fi;
    // tìm thấy thì ApiConfig.serverNotifier đổi và bản đồ tự nạp lại
    if (offline && !ApiConfig.discovering.value) ApiConfig.ensureReachable();

    setState(() {
      _offline = offline;
      _stations = (stations ?? _fallbackStations).map((s) => Map<String, dynamic>.from(s as Map)).toList();

      if (summary != null) {
        _wardPm.clear();
        for (final w in summary) {
          _wardPm['${w['ma_phuong_xa']}'] = AqiUtils.toDouble(w['pm2_5_trung_binh']);
        }
      }

      if (heat != null) {
        final points = <_HeatPoint>[];
        _stationPm.clear();
        for (final f in (heat['features'] as List? ?? const [])) {
          final c = f['geometry']?['coordinates'] as List?;
          final p = Map<String, dynamic>.from(f['properties'] ?? {});
          if (c == null || c.length < 2) continue;
          final pm = AqiUtils.toDouble(p['pm2_5']);
          points.add(_HeatPoint(LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()), pm));
          if (p['type'] == 'station') _stationPm['${p['code']}'] = pm;
        }
        _heat = points;
      }
      _loading = false;
    });
    AppState.refreshShared();
  }

  // ---------------------------------------------------------------------------
  // BẢN ĐỒ NỀN
  // ---------------------------------------------------------------------------
  _Basemap get _basemap => _basemaps.firstWhere((b) => b.id == _basemapId, orElse: () => _basemaps.first);

  Future<void> _restoreBasemap() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_prefBasemap);
    if (saved != null && mounted && _basemaps.any((b) => b.id == saved)) setState(() => _basemapId = saved);
  }

  Future<void> _setBasemap(String id) async {
    setState(() => _basemapId = id);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefBasemap, id);
  }

  // ---------------------------------------------------------------------------
  // SỐ LIỆU
  // ---------------------------------------------------------------------------
  double get _basePm => AqiUtils.toDouble(AppState.current.value?['pm2_5'], 22.5);
  bool get _useUS => AppState.useUSAQI.value;

  double _stationPmNow(Map<String, dynamic> st) {
    final known = _stationPm['${st['ma_tram']}'];
    if (known != null) return known;
    // Nội suy giống WebGIS khi chưa có dữ liệu bản đồ nhiệt
    final lat = AqiUtils.toDouble(st['lat']), lng = AqiUtils.toDouble(st['lng']);
    final hash = math.sin(lat * 120 + lng * 60).abs() * 0.20 + 0.90;
    return _basePm * hash;
  }

  /// PM2.5 tại điểm bất kỳ ngoài ranh giới phường: nội suy IDW từ các điểm bản đồ nhiệt
  double _interpolatePm(LatLng p) {
    if (_heat.isEmpty) return _basePm;
    const distance = Distance();
    double sum = 0, weight = 0;
    for (final h in _heat) {
      final km = distance.as(LengthUnit.Meter, p, h.point) / 1000;
      if (km < 0.05) return h.pmNow;
      final w = 1 / (km * km);
      sum += w * h.pmNow;
      weight += w;
    }
    return weight > 0 ? sum / weight : _basePm;
  }

  int _aqiAt(double pmNow) => AqiUtils.compute(AqiUtils.atHour(pmNow, _hour), useUS: _useUS);

  _Selection get _current {
    return _selection ?? _Selection('Trạm Trung tâm TP.HCM', 'Số liệu quan trắc thời gian thực', _basePm, _hcmCenter, Icons.cell_tower);
  }

  // ---------------------------------------------------------------------------
  // TƯƠNG TÁC
  // ---------------------------------------------------------------------------
  void _togglePlay() {
    setState(() => _playing = !_playing);
    _playTimer?.cancel();
    if (_playing) {
      _playTimer = Timer.periodic(const Duration(milliseconds: 1100), (_) {
        if (mounted) setState(() => _hour = (_hour + 1) % 24);
      });
    }
  }

  void _selectStation(Map<String, dynamic> st, {double? zoom}) {
    final point = LatLng(AqiUtils.toDouble(st['lat']), AqiUtils.toDouble(st['lng']));
    final pm = _stationPmNow(st);
    setState(() {
      _selection = _Selection('${st['ten_tram']}', 'Mã trạm ${st['ma_tram']} · ${st['status'] ?? 'HOẠT ĐỘNG'}', pm, point, Icons.cell_tower);
      _highlight = WardCatalog.locate(point);
    });
    _openPopup(_MapPopup(point, '${st['ten_tram']}', 'Trạm quan trắc · ${st['ma_tram']}', pm), zoom: zoom);
  }

  void _selectWard(WardShape w) {
    final pm = _wardPm[w.code] ?? _basePm;
    setState(() {
      _selection = _Selection(w.displayName, 'Ranh giới hành chính · mã ${w.code}', pm, w.center, Icons.location_city);
      _highlight = w;
    });
    _openPopup(_MapPopup(w.center, w.displayName, 'TP. Hồ Chí Minh', pm), zoom: 13.6);
  }

  /// Chạm vào bản đồ: xác định phường chứa điểm chạm và hiện popup chỉ số (giống WebGIS)
  void _onMapTap(LatLng point) {
    FocusScope.of(context).unfocus();
    final ward = WardCatalog.locate(point);
    if (ward != null) {
      final pm = _wardPm[ward.code] ?? _basePm;
      setState(() {
        _highlight = ward;
        _selection = _Selection(ward.displayName, 'Ranh giới hành chính · mã ${ward.code}', pm, point, Icons.location_city);
      });
      _openPopup(_MapPopup(point, ward.displayName, 'TP. Hồ Chí Minh', pm));
    } else {
      final pm = _interpolatePm(point);
      final coords = '${point.latitude.toStringAsFixed(4)}, ${point.longitude.toStringAsFixed(4)}';
      setState(() {
        _highlight = null;
        _selection = _Selection('Vị trí đã chọn', coords, pm, point, Icons.place);
      });
      _openPopup(_MapPopup(point, 'Vị trí đã chọn', coords, pm));
    }
  }

  void _openPopup(_MapPopup popup, {double? zoom}) {
    setState(() => _popup = popup);
    _focusPopup(popup.point, zoom: zoom);
  }

  void _closePopup() => setState(() => _popup = null);

  /// Dời bản đồ để popup không bị che bởi thanh tìm kiếm / thanh thời gian / mép màn hình
  void _focusPopup(LatLng point, {double? zoom}) {
    MapCamera cam;
    try {
      cam = _mapController.camera;
    } catch (_) {
      return; // Bản đồ chưa dựng xong
    }
    if (zoom != null) cam = cam.withPosition(center: point, zoom: zoom);
    final w = cam.nonRotatedSize.x, h = cam.nonRotatedSize.y;
    final p = cam.latLngToScreenPoint(point);

    // Chừa cột nút bên phải (12 lề + 48 nút + 8 khoảng cách) để nút không đè lên góc popup
    final half = _popupW / 2 + 10;
    final minX = math.min(half, w / 2);
    final maxX = math.max(minX, math.min(w - half, w - 68 - _popupW / 2));
    final minY = (_offline ? 196.0 : 146.0) + _popupCardH;
    final maxY = math.max(minY, h - 128);
    final dx = p.x.clamp(minX, maxX).toDouble();
    final dy = p.y.clamp(minY, maxY).toDouble();
    if (zoom == null && (dx - p.x).abs() < 1 && (dy - p.y).abs() < 1) return;

    final target = cam.pointToLatLng(math.Point(w / 2 + (p.x - dx), h / 2 + (p.y - dy)));
    _animateCamera(target, cam.zoom);
  }

  void _animateCamera(LatLng dest, double zoom) {
    final start = _mapController.camera;
    final from = start.center, z0 = start.zoom;
    if (_camListener != null) _camAnim.removeListener(_camListener!);
    _camListener = () {
      final t = Curves.easeOutCubic.transform(_camAnim.value);
      _mapController.move(
        LatLng(from.latitude + (dest.latitude - from.latitude) * t, from.longitude + (dest.longitude - from.longitude) * t),
        z0 + (zoom - z0) * t,
      );
    };
    _camAnim.addListener(_camListener!);
    _camAnim.forward(from: 0);
  }

  void _search(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return;
    FocusScope.of(context).unfocus();

    for (final st in _stations) {
      if ('${st['ten_tram']}'.toLowerCase().contains(q) || '${st['ma_tram']}'.toLowerCase().contains(q)) {
        _selectStation(st, zoom: 14);
        _toast('Đã định vị trạm: ${st['ten_tram']}');
        return;
      }
    }
    for (final w in _wards) {
      if (w.name.toLowerCase().contains(q) || w.displayName.toLowerCase().contains(q)) {
        _selectWard(w);
        _toast('Đã định vị: ${w.displayName}');
        return;
      }
    }
    _toast('Không tìm thấy "$query" trong 168 phường/xã và trạm quan trắc');
  }

  Future<void> _locateMe() async {
    setState(() => _locating = true);
    try {
      final pos = await LocationService.currentPosition();
      if (!mounted) return;
      setState(() {
        _pin = pos;
        _popup = null;
      });
      _mapController.move(pos, 14);
      await LocationInsightSheet.show(context, pos, title: 'Vị trí của bạn');
    } catch (e) {
      _toast('$e');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _analyze(LatLng point) {
    setState(() {
      _pin = point;
      _popup = null;
    });
    LocationInsightSheet.show(context, point);
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating, duration: const Duration(seconds: 2)),
    );
  }

  void _openProfile() {
    final user = AppState.user.value;
    if (user == null) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => const AuthScreen()));
      return;
    }
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _Avatar(user: user, size: 52),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${user['fullname'] ?? 'Thành viên'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                        Text('${user['email'] ?? ''}', style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(20)),
                    child: Text('${user['provider'] ?? 'Email'}',
                        style: const TextStyle(color: Color(0xFF15803D), fontWeight: FontWeight.bold, fontSize: 11)),
                  ),
                ],
              ),
              const Divider(height: 28),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.location_city_outlined),
                title: const Text('Khu vực theo dõi'),
                subtitle: Text('${user['ward'] ?? 'Tất cả TP.HCM'}'),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.dns_outlined),
                title: const Text('Cài đặt máy chủ'),
                onTap: () {
                  Navigator.pop(ctx);
                  ServerSettingsSheet.show(context).then((changed) {
                    if (changed) _loadData();
                  });
                },
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton.tonalIcon(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFFEE2E2), foregroundColor: AppColors.danger),
                  icon: const Icon(Icons.logout, size: 18),
                  label: const Text('Đăng xuất'),
                  onPressed: () async {
                    await AppState.logout();
                    if (ctx.mounted) Navigator.pop(ctx);
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _openLayers() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          Widget sw(String label, IconData icon, Color color, bool value, ValueChanged<bool> onChanged) => SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                secondary: Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: Icon(icon, color: color, size: 18),
                ),
                title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                value: value,
                onChanged: (v) {
                  onChanged(v);
                  setSheet(() {});
                  setState(() {});
                },
              );
          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Bản đồ nền', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      for (final b in _basemaps)
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: _basemapTile(b, () {
                              _setBasemap(b.id);
                              setSheet(() {});
                            }),
                          ),
                        ),
                    ],
                  ),
                  const Divider(height: 26),
                  const Text('Lớp dữ liệu WebGIS', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  const SizedBox(height: 4),
                  sw('Trạm quan trắc', Icons.cell_tower, AppColors.brand, _showStations, (v) => _showStations = v),
                  sw('Bản đồ nhiệt (Heatmap)', Icons.local_fire_department, const Color(0xFFEA580C), _showHeat, (v) => _showHeat = v),
                  sw('Ranh giới phường/xã', Icons.map_outlined, const Color(0xFF7C3AED), _showWards, (v) => _showWards = v),
                  const Divider(height: 22),
                  Text('Thang màu ${AqiUtils.standardLabel(_useUS)}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: const [25, 75, 125, 175, 250, 350]
                        .map((aqi) => AqiPill(aqi: aqi, dense: true))
                        .toList(),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                      'Mẹo: chạm vào bản đồ để xem nhanh AQI, PM2.5, nhiệt độ và gió; nhấn giữ để phân tích chi tiết dự báo 24h tại điểm đó.',
                      style: TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _basemapTile(_Basemap b, VoidCallback onTap) {
    final selected = b.id == _basemapId;
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            height: 66,
            decoration: BoxDecoration(
              color: b.fallback,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: selected ? AppColors.brand : AppColors.line, width: selected ? 2.5 : 1),
              boxShadow: selected ? [BoxShadow(color: AppColors.brand.withValues(alpha: 0.25), blurRadius: 10)] : null,
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.network(b.thumbnail, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.shrink()),
                if (b.labelsUrl != null)
                  Image.network(
                    b.labelsUrl!.replaceAll('{z}', '11').replaceAll('{x}', '1631').replaceAll('{y}', '962'),
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                if (selected)
                  const Positioned(
                    top: 4,
                    right: 4,
                    child: CircleAvatar(radius: 9, backgroundColor: AppColors.brand, child: Icon(Icons.check, size: 12, color: Colors.white)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 5),
          Text(b.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                color: selected ? AppColors.brand : AppColors.text2,
              )),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // GIAO DIỆN
  // ---------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final basemap = _basemap;
    final popup = _popup;
    return Stack(
      children: [
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: _hcmCenter,
            initialZoom: 11.2,
            minZoom: 5,
            maxZoom: 18.5,
            backgroundColor: basemap.fallback,
            onTap: (_, latLng) => _onMapTap(latLng),
            onLongPress: (_, latLng) => _analyze(latLng),
          ),
          children: [
            TileLayer(
              key: ValueKey(basemap.id),
              urlTemplate: basemap.url,
              maxNativeZoom: basemap.maxNativeZoom,
              userAgentPackageName: 'com.airhcm.mobile',
            ),
            if (basemap.labelsUrl != null)
              TileLayer(
                key: const ValueKey('labels'),
                urlTemplate: basemap.labelsUrl!,
                maxNativeZoom: 18,
                userAgentPackageName: 'com.airhcm.mobile',
              ),
            if (_showWards) PolygonLayer(polygons: _buildWardPolygons()),
            if (_showHeat) CircleLayer(circles: _buildHeatCircles()),
            if (_showStations) MarkerLayer(markers: _buildStationMarkers()),
            if (_pin != null)
              MarkerLayer(markers: [
                Marker(
                  point: _pin!,
                  width: 40,
                  height: 40,
                  alignment: Alignment.topCenter,
                  child: const Icon(Icons.location_on, color: AppColors.danger, size: 40, shadows: [Shadow(color: Colors.black26, blurRadius: 6)]),
                ),
              ]),
            if (popup != null)
              MarkerLayer(markers: [
                Marker(point: popup.point, width: 18, height: 18, child: const _TapDot()),
                Marker(
                  point: popup.point,
                  width: _popupW,
                  height: _popupBoxH,
                  alignment: Alignment.topCenter,
                  child: _popupCard(popup),
                ),
              ]),
          ],
        ),

        // Thanh tìm kiếm + tài khoản + cảnh báo
        Positioned(
          top: 12,
          left: 12,
          right: 12,
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(child: _searchBox()),
                  const SizedBox(width: 8),
                  _profileButton(),
                ],
              ),
              const SizedBox(height: 8),
              if (_offline) _offlineBanner(),
              AlertStatusCard(alert: AppState.alert.value, compact: true, onTap: () => AppState.tabIndex.value = 3),
            ],
          ),
        ),

        // Nút chức năng bên phải (hạ xuống khi thẻ chỉ số ẩn để nhường chỗ cho popup)
        AnimatedPositioned(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOutCubic,
          right: 12,
          bottom: popup == null ? 330 : 128,
          child: Column(
            children: [
              _fab(icon: Icons.layers_outlined, tooltip: 'Bản đồ nền & lớp dữ liệu', onTap: _openLayers),
              const SizedBox(height: 10),
              _fab(icon: Icons.center_focus_strong, tooltip: 'Về TP.HCM', onTap: () {
                _mapController.move(_hcmCenter, 11.2);
                setState(() {
                  _selection = null;
                  _highlight = null;
                  _popup = null;
                });
              }),
              const SizedBox(height: 10),
              _fab(
                icon: Icons.my_location,
                tooltip: 'Vị trí của tôi',
                onTap: _locating ? null : _locateMe,
                primary: true,
                loading: _locating,
              ),
            ],
          ),
        ),

        // Mô phỏng 24h + thẻ chỉ số (thẻ ẩn khi đang mở popup)
        Positioned(
          left: 12,
          right: 12,
          bottom: 12,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _attribution(basemap),
              const SizedBox(height: 4),
              _timelineBar(),
              if (popup == null) ...[
                const SizedBox(height: 10),
                _infoCard(),
              ],
            ],
          ),
        ),

        if (_loading)
          const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 3)),
      ],
    );
  }

  Widget _attribution(_Basemap b) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.72), borderRadius: BorderRadius.circular(6)),
      child: Text(b.attribution, style: const TextStyle(fontSize: 9, color: AppColors.text2)),
    );
  }

  List<Polygon> _buildWardPolygons() {
    final polys = <Polygon>[];
    final dark = _basemapId == 'dark' || _basemapId == 'satellite';
    for (final w in _wards) {
      final aqi = _aqiAt(_wardPm[w.code] ?? _basePm);
      final color = AqiUtils.color(aqi);
      final selected = identical(w, _highlight);
      for (final ring in w.rings) {
        polys.add(Polygon(
          points: ring,
          color: selected ? const Color(0x660284C7) : color.withValues(alpha: dark ? 0.34 : 0.28),
          borderColor: selected ? (dark ? Colors.white : AppColors.brand) : color.withValues(alpha: 0.75),
          borderStrokeWidth: selected ? 3 : 0.8,
          isFilled: true,
        ));
      }
    }
    return polys;
  }

  List<CircleMarker> _buildHeatCircles() {
    final circles = <CircleMarker>[];
    for (final h in _heat) {
      final color = AqiUtils.color(_aqiAt(h.pmNow));
      circles.add(CircleMarker(point: h.point, radius: 1600, useRadiusInMeter: true, color: color.withValues(alpha: 0.10)));
      circles.add(CircleMarker(point: h.point, radius: 800, useRadiusInMeter: true, color: color.withValues(alpha: 0.16)));
    }
    return circles;
  }

  List<Marker> _buildStationMarkers() {
    return _stations.map((st) {
      final aqi = _aqiAt(_stationPmNow(st));
      final color = AqiUtils.color(aqi);
      final maintenance = st['status'] == 'BẢO TRÌ';
      return Marker(
        point: LatLng(AqiUtils.toDouble(st['lat']), AqiUtils.toDouble(st['lng'])),
        width: 42,
        height: 42,
        child: GestureDetector(
          onTap: () => _selectStation(st),
          child: Container(
            decoration: BoxDecoration(
              color: maintenance ? Colors.grey : color,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2.5),
              boxShadow: [BoxShadow(color: color.withValues(alpha: 0.55), blurRadius: 10, spreadRadius: 1)],
            ),
            child: Center(
              child: maintenance
                  ? const Icon(Icons.build, color: Colors.white, size: 16)
                  : Text('$aqi', style: TextStyle(color: AqiUtils.onColor(aqi), fontWeight: FontWeight.w900, fontSize: 12.5)),
            ),
          ),
        ),
      );
    }).toList();
  }

  // ---------------------------------------------------------------------------
  // POPUP CHỈ SỐ TẠI ĐIỂM CHẠM (AQI · PM2.5 · NHIỆT ĐỘ · GIÓ · DSS)
  // ---------------------------------------------------------------------------
  Widget _popupCard(_MapPopup pop) {
    final pm = AqiUtils.atHour(pop.pmNow, _hour);
    final aqi = AqiUtils.compute(pm, useUS: _useUS);
    final color = AqiUtils.color(aqi);
    final ring = AqiUtils.levelIndex(aqi) == 2 ? const Color(0xFFEAB308) : color;
    final temp = WeatherField.temperature(pop.point, _hour);
    final wind = WeatherField.wind(pop.point, _hour);
    final advice = AqiUtils.advice(aqi);
    final alert = AppState.alert.value;
    final bestWindow = alert?['status'] == 'WARNING' && alert?['best_window'] is Map ? '${alert!['best_window']['label'] ?? ''}' : '';
    final hh = '${_hour.toString().padLeft(2, '0')}:00';

    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.1,
      child: Align(
        alignment: Alignment.bottomCenter,
        // Chặn chạm xuyên xuống bản đồ (không làm popup nhảy sang điểm khác)
        child: GestureDetector(
          onTap: () {},
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: _popupW,
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: const [BoxShadow(color: Color(0x330F172A), blurRadius: 22, offset: Offset(0, 8))],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 58,
                          height: 58,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: Colors.white,
                            border: Border.all(color: ring, width: 4.5),
                            boxShadow: [BoxShadow(color: color.withValues(alpha: 0.38), blurRadius: 12)],
                          ),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text('$aqi', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: AppColors.text, height: 1.05)),
                              Text(AqiUtils.standardLabel(_useUS),
                                  style: const TextStyle(fontSize: 7.5, fontWeight: FontWeight.w800, color: AppColors.muted)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(pop.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: AppColors.text, height: 1.2)),
                              const SizedBox(height: 2),
                              Text('${pop.subtitle} · lúc $hh',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                              const SizedBox(height: 5),
                              AqiPill(aqi: aqi, text: AqiUtils.level(aqi), dense: true),
                            ],
                          ),
                        ),
                        InkResponse(
                          onTap: _closePopup,
                          radius: 18,
                          child: const Padding(
                            padding: EdgeInsets.all(2),
                            child: Icon(Icons.close_rounded, size: 20, color: AppColors.muted),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: _popMetric(Icons.blur_on, 'PM2.5', pm.toStringAsFixed(1), 'µg/m³', AqiUtils.strong(aqi),
                              note: pm <= 50 ? 'Đạt QCVN' : 'Vượt QCVN', noteColor: pm <= 50 ? AppColors.success : AppColors.danger),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: _popMetric(Icons.thermostat, 'Nhiệt độ', temp.toStringAsFixed(1), '°C', const Color(0xFFEA580C),
                              note: _thermalLabel(temp)),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: _popMetric(Icons.air, 'Gió', wind.speed.toStringAsFixed(1), 'm/s', AppColors.brand,
                              note: wind.direction),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(10, 8, 10, 9),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF0F9FF),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFBAE6FD)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.medical_services_outlined, size: 14, color: Color(0xFF0369A1)),
                              SizedBox(width: 6),
                              Text('Hỗ trợ ra quyết định',
                                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 11.5, color: Color(0xFF0369A1))),
                            ],
                          ),
                          const SizedBox(height: 5),
                          _dssLine('Cộng đồng', advice.general),
                          const SizedBox(height: 3),
                          _dssLine('Nhóm nhạy cảm', advice.sensitive),
                          if (bestWindow.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                const Icon(Icons.wb_sunny_outlined, size: 13, color: Color(0xFFD97706)),
                                const SizedBox(width: 5),
                                Expanded(
                                  child: Text.rich(
                                    TextSpan(text: 'Nên ra ngoài: ', children: [
                                      TextSpan(text: bestWindow, style: const TextStyle(fontWeight: FontWeight.w800)),
                                    ]),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 11.5, color: Color(0xFF92400E)),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      height: 38,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
                        ),
                        onPressed: () => LocationInsightSheet.show(context, pop.point, title: pop.title),
                        icon: const Icon(Icons.query_stats, size: 17),
                        label: const Text('Chi tiết & dự báo 24h'),
                      ),
                    ),
                  ],
                ),
              ),
              const CustomPaint(size: Size(22, 11), painter: _PopupPointerPainter()),
            ],
          ),
        ),
      ),
    );
  }

  static String _thermalLabel(double t) {
    if (t < 22) return 'Mát';
    if (t < 30) return 'Dễ chịu';
    if (t < 34) return 'Nóng';
    return 'Nắng nóng';
  }

  Widget _popMetric(IconData icon, String label, String value, String unit, Color color, {String? note, Color? noteColor}) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 13, color: color),
              const SizedBox(width: 3),
              Flexible(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text.rich(TextSpan(
              text: value,
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: color),
              children: [TextSpan(text: ' $unit', style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: AppColors.muted))],
            )),
          ),
          Text(note ?? ' ',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: noteColor ?? AppColors.text2)),
        ],
      ),
    );
  }

  Widget _dssLine(String label, String text) {
    return Text.rich(
      TextSpan(children: [
        TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.text)),
        TextSpan(text: text),
      ]),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(fontSize: 11.5, color: AppColors.text2, height: 1.3),
    );
  }

  // ---------------------------------------------------------------------------
  // THÀNH PHẦN NỔI
  // ---------------------------------------------------------------------------
  Widget _searchBox() {
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [BoxShadow(color: Color(0x1F0F172A), blurRadius: 12, offset: Offset(0, 4))],
      ),
      child: TextField(
        controller: _searchCtrl,
        textInputAction: TextInputAction.search,
        onSubmitted: _search,
        decoration: InputDecoration(
          hintText: 'Tìm phường/xã hoặc trạm quan trắc...',
          hintStyle: const TextStyle(fontSize: 13.5, color: AppColors.muted),
          prefixIcon: const Icon(Icons.search, color: AppColors.brand),
          suffixIcon: IconButton(
            icon: const Icon(Icons.close, size: 18, color: AppColors.muted),
            onPressed: () {
              _searchCtrl.clear();
              setState(() {
                _highlight = null;
                _selection = null;
                _popup = null;
              });
            },
          ),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        ),
      ),
    );
  }

  Widget _profileButton() {
    return ValueListenableBuilder<Map<String, dynamic>?>(
      valueListenable: AppState.user,
      builder: (_, user, _) => GestureDetector(
        onTap: _openProfile,
        child: Container(
          height: 48,
          padding: EdgeInsets.symmetric(horizontal: user == null ? 14 : 5),
          decoration: BoxDecoration(
            gradient: user == null ? AppColors.brandGradient : null,
            color: user == null ? null : Colors.white,
            borderRadius: BorderRadius.circular(14),
            boxShadow: const [BoxShadow(color: Color(0x1F0F172A), blurRadius: 12, offset: Offset(0, 4))],
          ),
          child: user == null
              ? const Row(children: [
                  Icon(Icons.person_outline, color: Colors.white, size: 18),
                  SizedBox(width: 6),
                  Text('Đăng nhập', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12.5)),
                ])
              : _Avatar(user: user, size: 38),
        ),
      ),
    );
  }

  Widget _offlineBanner() {
    final searching = ApiConfig.discovering.value;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: const Color(0xFFFFF7ED), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFFDBA74))),
      child: Row(
        children: [
          searching
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Color(0xFFEA580C)))
              : const Icon(Icons.cloud_off, size: 18, color: Color(0xFFEA580C)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              searching ? 'Đang tự tìm máy chủ AirHCM trong mạng Wi-Fi...' : 'Chưa kết nối máy chủ - đang hiển thị dữ liệu dự phòng',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
          TextButton(
            onPressed: () async {
              if (await ServerSettingsSheet.show(context)) _loadData();
            },
            child: const Text('Cài đặt'),
          ),
        ],
      ),
    );
  }

  Widget _fab({required IconData icon, required String tooltip, VoidCallback? onTap, bool primary = false, bool loading = false}) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Ink(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              gradient: primary ? AppColors.brandGradient : null,
              color: primary ? null : Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: const [BoxShadow(color: Color(0x260F172A), blurRadius: 12, offset: Offset(0, 4))],
            ),
            child: loading
                ? const Padding(padding: EdgeInsets.all(14), child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                : Icon(icon, color: primary ? Colors.white : AppColors.brand),
          ),
        ),
      ),
    );
  }

  Widget _timelineBar() {
    final isNow = _hour == DateTime.now().hour;
    return Container(
      padding: const EdgeInsets.fromLTRB(6, 6, 14, 2),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [BoxShadow(color: Color(0x1F0F172A), blurRadius: 14, offset: Offset(0, 4))],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: _togglePlay,
                iconSize: 38,
                icon: Icon(_playing ? Icons.pause_circle_filled : Icons.play_circle_fill,
                    color: _playing ? const Color(0xFFF59E0B) : AppColors.brand),
              ),
              Text('${_hour.toString().padLeft(2, '0')}:00',
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 19, color: AppColors.text)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: const Color(0xFFE0F2FE), borderRadius: BorderRadius.circular(20)),
                child: Text(AqiUtils.periodLabel(_hour),
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFF0369A1))),
              ),
              const Spacer(),
              if (!isNow)
                TextButton(
                  onPressed: () => setState(() => _hour = DateTime.now().hour),
                  child: const Text('Hiện tại', style: TextStyle(fontSize: 12)),
                )
              else
                const Text('Mô phỏng 24h', style: TextStyle(fontSize: 11, color: AppColors.muted, fontWeight: FontWeight.w700)),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(trackHeight: 5, overlayShape: SliderComponentShape.noOverlay),
            child: Slider(
              value: _hour.toDouble(),
              min: 0,
              max: 23,
              divisions: 23,
              label: '${_hour.toString().padLeft(2, '0')}:00',
              onChanged: (v) => setState(() => _hour = v.toInt()),
            ),
          ),
          const SizedBox(height: 6),
        ],
      ),
    );
  }

  Widget _infoCard() {
    final sel = _current;
    final pm = AqiUtils.atHour(sel.pmNow, _hour);
    final aqi = AqiUtils.compute(pm, useUS: _useUS);
    final color = AqiUtils.color(aqi);
    final temp = WeatherField.temperature(sel.point, _hour);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [BoxShadow(color: Color(0x240F172A), blurRadius: 16, offset: Offset(0, 6))],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(gradient: AppColors.brandGradient, borderRadius: BorderRadius.circular(10)),
                child: Icon(sel.icon, color: Colors.white, size: 17),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(sel.title, maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppColors.text)),
                    Text(sel.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                  ],
                ),
              ),
              _standardSwitch(),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Container(
                width: 66,
                height: 66,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  border: Border.all(color: AqiUtils.levelIndex(aqi) == 2 ? const Color(0xFFEAB308) : color, width: 4.5),
                  boxShadow: [BoxShadow(color: color.withValues(alpha: 0.4), blurRadius: 12)],
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('$aqi', style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: AppColors.text)),
                    Text(AqiUtils.standardLabel(_useUS), style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w800, color: AppColors.muted)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AqiPill(aqi: aqi, text: AqiUtils.level(aqi)),
                    const SizedBox(height: 5),
                    Text(
                      pm <= 50 ? 'Đạt quy chuẩn QCVN 05:2023 (≤ 50 µg/m³)' : 'Vượt ngưỡng QCVN 05:2023 (> 50 µg/m³)',
                      style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: pm <= 50 ? AppColors.brand : AppColors.danger),
                    ),
                  ],
                ),
              ),
              IconButton.filledTonal(
                tooltip: 'Phân tích dự báo tại đây',
                onPressed: () => LocationInsightSheet.show(context, sel.point, title: sel.title),
                icon: const Icon(Icons.query_stats),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _metric('PM2.5', '${pm.toStringAsFixed(1)} µg/m³', AppColors.brand)),
              const SizedBox(width: 6),
              Expanded(child: _metric('PM10', '${(pm * 1.35).toStringAsFixed(1)} µg/m³', const Color(0xFF7C3AED))),
              const SizedBox(width: 6),
              Expanded(child: _metric('Nhiệt độ', '${temp.toStringAsFixed(1)} °C', const Color(0xFFEA580C))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _standardSwitch() {
    Widget item(String label, bool active, VoidCallback onTap) => GestureDetector(
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: active ? Colors.white : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
              boxShadow: active ? const [BoxShadow(color: Color(0x1A0F172A), blurRadius: 4)] : null,
            ),
            child: Text(label, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: active ? AppColors.brand : AppColors.muted)),
          ),
        );
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        item('VN_AQI', !_useUS, () => AppState.useUSAQI.value = false),
        item('US AQI', _useUS, () => AppState.useUSAQI.value = true),
      ]),
    );
  }

  Widget _metric(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
      decoration: BoxDecoration(color: AppColors.surface2, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.line)),
      child: Column(
        children: [
          Text(label, style: const TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: color)),
        ],
      ),
    );
  }
}

/// Chấm đánh dấu điểm vừa chạm (dưới mũi nhọn popup)
class _TapDot extends StatelessWidget {
  const _TapDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.brand,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: const [BoxShadow(color: Color(0x660284C7), blurRadius: 8, spreadRadius: 2)],
      ),
    );
  }
}

/// Mũi nhọn tam giác dưới popup chỉ vào điểm chạm
class _PopupPointerPainter extends CustomPainter {
  const _PopupPointerPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawShadow(path, const Color(0x660F172A), 3, false);
    canvas.drawPath(path, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Avatar extends StatelessWidget {
  final Map<String, dynamic> user;
  final double size;
  const _Avatar({required this.user, required this.size});

  @override
  Widget build(BuildContext context) {
    final name = '${user['fullname'] ?? user['email'] ?? 'U'}'.trim();
    final initial = name.isEmpty ? 'U' : name.characters.first.toUpperCase();
    var avatar = '${user['avatar'] ?? ''}';
    // Ảnh Facebook do máy chủ lưu lại (/api/v1/avatars/...) -> ghép với địa chỉ máy chủ đang dùng
    if (avatar.startsWith('/')) avatar = '${ApiConfig.server}$avatar';
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: AppColors.brandGradient,
        border: Border.all(color: Colors.white, width: 2),
      ),
      clipBehavior: Clip.antiAlias,
      child: avatar.startsWith('http')
          ? Image.network(avatar, fit: BoxFit.cover, errorBuilder: (_, _, _) => _initial(initial))
          : _initial(initial),
    );
  }

  Widget _initial(String initial) => Center(
        child: Text(initial, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: size * 0.4)),
      );
}
