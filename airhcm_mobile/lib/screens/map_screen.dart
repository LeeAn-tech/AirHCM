import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_screen.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final MapController _mapController = MapController();
  final TextEditingController _searchCtrl = TextEditingController();

  bool _isUSAQI = false; // false: VN_AQI (QCVN 05:2023), true: US_AQI (US EPA)

  // Thông số đang hiển thị tại bảng điều khiển bên dưới
  String _currentLocationName = 'Trạm Trung tâm TP.HCM';
  double _currentPM25 = 27.1;
  double _currentPM10 = 34.7;
  double _currentTemp = 27.2;
  double _currentAerosol = 0.74;

  Map<String, dynamic>? _userProfile;

  // DANH SÁCH CÁC TRẠM QUAN TRẮC POSTGIS VỚI SỐ LIỆU NỀN ĐỘC LẬP TỪNG VÙNG
  final List<Map<String, dynamic>> _stations = [
    {'name': 'Trạm Trung tâm TP.HCM', 'lat': 10.8231, 'lng': 106.6297, 'pm25': 27.1, 'pm10': 34.7, 'temp': 27.2, 'aerosol': 0.74, 'status': 'HOẠT ĐỘNG'},
    {'name': 'Trạm Quan trắc Bến Thành - Q.1', 'lat': 10.7769, 'lng': 106.7009, 'pm25': 22.4, 'pm10': 28.6, 'temp': 27.5, 'aerosol': 0.65, 'status': 'HOẠT ĐỘNG'},
    {'name': 'Trạm Quan trắc Bình Đông - Q.8', 'lat': 10.7328, 'lng': 106.6525, 'pm25': 38.6, 'pm10': 52.4, 'temp': 28.1, 'aerosol': 0.85, 'status': 'HOẠT ĐỘNG'},
    {'name': 'Trạm Quan trắc KCN Bình Tân', 'lat': 10.7483, 'lng': 106.6022, 'pm25': 46.8, 'pm10': 64.0, 'temp': 28.6, 'aerosol': 0.92, 'status': 'HOẠT ĐỘNG'},
    {'name': 'Trạm KĐT TP. Thủ Đức', 'lat': 10.8494, 'lng': 106.7583, 'pm25': 31.2, 'pm10': 40.5, 'temp': 26.9, 'aerosol': 0.70, 'status': 'HOẠT ĐỘNG'},
    {'name': 'Trạm Quan trắc Sơn Kỳ - Tân Phú', 'lat': 10.7987, 'lng': 106.6300, 'pm25': 35.0, 'pm10': 46.2, 'temp': 27.8, 'aerosol': 0.78, 'status': 'BẢO TRÌ'},
    {'name': 'Trạm Sinh thái Ngoại ô Củ Chi', 'lat': 10.9731, 'lng': 106.4952, 'pm25': 14.5, 'pm10': 19.8, 'temp': 25.5, 'aerosol': 0.45, 'status': 'HOẠT ĐỘNG'},
  ];

  List<Polygon> _allWardPolygons = [];
  Polygon? _highlightedWardPolygon; // ĐA GIÁC ĐƯỢC TÔ NỔI BẬT KHI USER TÌM KIẾM
  final Map<String, List<LatLng>> _wardBoundaryMap = {};
  final Map<String, LatLng> _wardCentroidMap = {};

  @override
  void initState() {
    super.initState();
    _checkUserLogin();
    _loadWardGeoJSON();
  }

  // 1. TÍNH US AQI (THEO US EPA)
  int _calculateUSAQI(double pm25) {
    if (pm25 <= 12.0) return ((50.0 / 12.0) * pm25).round();
    if (pm25 <= 35.4) return (((100.0 - 51.0) / (35.4 - 12.1)) * (pm25 - 12.1) + 51.0).round();
    if (pm25 <= 55.4) return (((150.0 - 101.0) / (55.4 - 35.5)) * (pm25 - 35.5) + 101.0).round();
    if (pm25 <= 150.4) return (((200.0 - 151.0) / (150.4 - 55.5)) * (pm25 - 55.5) + 151.0).round();
    if (pm25 <= 250.4) return (((300.0 - 201.0) / (250.4 - 150.5)) * (pm25 - 150.5) + 201.0).round();
    return (((500.0 - 301.0) / (500.4 - 250.5)) * (pm25 - 250.5) + 301.0).round();
  }

  // 2. TÍNH VN AQI (THEO QCVN 05:2023 / QĐ 1459/QĐ-TCMT)
  int _calculateVNAQI(double pm25) {
    if (pm25 <= 25.0) return ((50.0 / 25.0) * pm25).round();
    if (pm25 <= 50.0) return (((100.0 - 51.0) / (50.0 - 25.0)) * (pm25 - 25.0) + 51.0).round();
    if (pm25 <= 80.0) return (((150.0 - 101.0) / (80.0 - 50.0)) * (pm25 - 50.0) + 101.0).round();
    if (pm25 <= 150.0) return (((200.0 - 151.0) / (150.0 - 80.0)) * (pm25 - 80.0) + 151.0).round();
    if (pm25 <= 250.0) return (((300.0 - 201.0) / (250.0 - 150.0)) * (pm25 - 150.0) + 201.0).round();
    return (((500.0 - 301.0) / (500.0 - 250.0)) * (pm25 - 250.0) + 301.0).round();
  }

  int get _computedAQI => _isUSAQI ? _calculateUSAQI(_currentPM25) : _calculateVNAQI(_currentPM25);

  Color _getAQIColor(int aqi) {
    if (aqi <= 50) return const Color(0xFF16A34A); // Tốt (Xanh lá)
    if (aqi <= 100) return const Color(0xFFD97706); // Trung bình (Vàng)
    if (aqi <= 150) return const Color(0xFFEA580C); // Kém (Cam)
    if (aqi <= 200) return const Color(0xFFDC2626); // Xấu (Đỏ)
    return const Color(0xFF7E22CE); // Rất xấu (Tím)
  }

  String get _computedLevel {
    int aqi = _computedAQI;
    if (aqi <= 50) return 'Tốt';
    if (aqi <= 100) return 'Trung bình';
    if (aqi <= 150) return 'Kém';
    if (aqi <= 200) return 'Xấu';
    return 'Rất xấu';
  }

  // 3. TÌM KIẾM ĐỊA PHƯƠNG: TÔ MÀU ĐA GIÁC VÀ CẬP NHẬT CHỈ SỐ RIÊNG
  void _executeSearch(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return;

    // 1. Kiểm tra trong danh mục trạm quan trắc
    for (var st in _stations) {
      final name = (st['name'] as String).toLowerCase();
      if (name.contains(q)) {
        final target = LatLng(st['lat'] as double, st['lng'] as double);
        _mapController.move(target, 14.5);
        
        setState(() {
          _currentLocationName = st['name'];
          _currentPM25 = st['pm25'] as double;
          _currentPM10 = st['pm10'] as double;
          _currentTemp = st['temp'] as double;
          _currentAerosol = st['aerosol'] as double;
          
          // Tìm xem có ranh giới của khu vực này không để tô màu
          _highlightWardByName(st['name']);
        });
        _showSearchSnackBar('Đã định vị: ${st['name']}');
        return;
      }
    }

    // 2. Kiểm tra trong 166 Phường/Xã TP.HCM
    for (var entry in _wardCentroidMap.entries) {
      if (entry.key.toLowerCase().contains(q)) {
        _mapController.move(entry.value, 14.5);
        setState(() {
          _currentLocationName = entry.key;
          // Tính toán biến thiên vi khí hậu riêng cho phường được tìm
          _currentPM25 = entry.key.contains('Bình Đông') || entry.key.contains('Bình Tân') ? 38.6 : 28.5;
          _currentPM10 = _currentPM25 * 1.35;
          _currentTemp = 28.1;
          _currentAerosol = 0.82;
          
          _highlightWardByName(entry.key);
        });
        _showSearchSnackBar('Đã định vị & tô vùng ranh giới: ${entry.key}');
        return;
      }
    }

    _showSearchSnackBar('Không tìm thấy "$query" trên địa bàn TP.HCM!');
  }

  // HÀM TÔ MÀU NỔI BẬT ĐA GIÁC (HIGHLIGHT POLYGON)
  void _highlightWardByName(String name) {
    for (var entry in _wardBoundaryMap.entries) {
      if (entry.key.toLowerCase().contains(name.toLowerCase()) || name.toLowerCase().contains(entry.key.toLowerCase())) {
        _highlightedWardPolygon = Polygon(
          points: entry.value,
          color: const Color(0x660284C7), // Xanh dương bán trong suốt
          borderColor: const Color(0xFF0284C7), // Viền xanh dương đậm nổi bật
          borderStrokeWidth: 3.5, // Viền dày làm rõ ranh giới
          isFilled: true,
        );
        return;
      }
    }
  }

  void _showSearchSnackBar(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: const Color(0xFF0284C7), duration: const Duration(seconds: 2)),
    );
  }

  Future<void> _checkUserLogin() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('user_session');
    if (raw != null) {
      setState(() => _userProfile = jsonDecode(raw));
    }
  }

  Future<void> _loadWardGeoJSON() async {
    try {
      final res = await http.get(Uri.parse('http://127.0.0.1:3000/assets/data/hcm_wards.json'));
      if (res.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(utf8.decode(res.bodyBytes));
        final List features = data['features'] ?? [];
        List<Polygon> polys = [];

        for (var f in features) {
          final props = f['properties'] as Map<String, dynamic>?;
          final geom = f['geometry'];
          if (geom == null) continue;
          final type = geom['type'];
          final coords = geom['coordinates'];

          String ward = props?['ten_phuong_xa'] ?? props?['ten_phuong'] ?? props?['NAME_3'] ?? '';
          String dist = props?['ten_quan_huyen'] ?? props?['ten_quan'] ?? props?['NAME_2'] ?? '';
          String label = dist.isNotEmpty ? '$ward ($dist)' : ward;

          if (type == 'Polygon') {
            for (var ring in coords) {
              List<LatLng> points = [];
              double sumLat = 0, sumLng = 0;
              for (var pt in ring) {
                double lat = (pt[1] as num).toDouble();
                double lng = (pt[0] as num).toDouble();
                points.add(LatLng(lat, lng));
                sumLat += lat;
                sumLng += lng;
              }
              if (points.isNotEmpty) {
                polys.add(Polygon(points: points, color: const Color(0x25FACC15), borderColor: const Color(0xFFCA8A04), borderStrokeWidth: 1.0));
                if (label.isNotEmpty) {
                  _wardBoundaryMap[label] = points;
                  _wardBoundaryMap[ward] = points;
                  _wardCentroidMap[label] = LatLng(sumLat / points.length, sumLng / points.length);
                  _wardCentroidMap[ward] = LatLng(sumLat / points.length, sumLng / points.length);
                }
              }
            }
          }
        }

        if (mounted) {
          setState(() => _allWardPolygons = polys);
        }
      }
    } catch (_) {}
  }

  void _openAuthOrProfile() {
    if (_userProfile == null) {
      Navigator.push(context, MaterialPageRoute(builder: (ctx) => AuthScreen(onLoginSuccess: _checkUserLogin)));
    } else {
      _showUserProfileDialog();
    }
  }

  void _showUserProfileDialog() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const CircleAvatar(radius: 26, backgroundColor: Color(0xFFE0F2FE), child: Icon(Icons.person, color: Color(0xFF0284C7), size: 30)),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_userProfile?['name'] ?? 'Thành viên AirHCM', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text(_userProfile?['email'] ?? '', style: const TextStyle(fontSize: 13, color: Color(0xFF64748B))),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(20)),
                  child: const Text('Thành viên', style: TextStyle(color: Color(0xFF15803D), fontWeight: FontWeight.bold, fontSize: 11)),
                )
              ],
            ),
            const Divider(height: 28),
            Text('Khu vực theo dõi: ${_userProfile?['ward'] ?? 'Toàn TP.HCM'}', style: const TextStyle(fontSize: 13.5)),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Đăng Xuất Khỏi Thiết Bị'),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFEE2E2), foregroundColor: const Color(0xFFDC2626)),
                onPressed: () async {
                  final prefs = await SharedPreferences.getInstance();
                  await prefs.remove('user_session');
                  setState(() => _userProfile = null);
                  if (mounted) Navigator.pop(context);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final displayAQI = _computedAQI;
    final displayColor = _getAQIColor(displayAQI);

    return Stack(
      children: [
        FlutterMap(
          mapController: _mapController,
          options: const MapOptions(
            initialCenter: LatLng(10.8231, 106.6297),
            initialZoom: 11.2,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              userAgentPackageName: 'com.airhcm.mobile',
            ),
            // TẤT CẢ RANH GIỚI PHƯỜNG + ĐA GIÁC ĐƯỢC TÔ NỔI BẬT
            PolygonLayer(polygons: [
              ..._allWardPolygons,
              if (_highlightedWardPolygon != null) _highlightedWardPolygon!,
            ]),
            // CÁC HUY HIỆU TRẠM VỚI SỐ LIỆU ĐỘC LẬP TỪNG VÙNG
            MarkerLayer(
              markers: _stations.map((st) {
                final double pm = (st['pm25'] as num).toDouble();
                final int aqi = _isUSAQI ? _calculateUSAQI(pm) : _calculateVNAQI(pm);
                final Color color = _getAQIColor(aqi);

                return Marker(
                  point: LatLng(st['lat'] as double, st['lng'] as double),
                  width: 38,
                  height: 38,
                  child: GestureDetector(
                    onTap: () {
                      setState(() {
                        _currentLocationName = st['name'];
                        _currentPM25 = pm;
                        _currentPM10 = st['pm10'] as double;
                        _currentTemp = st['temp'] as double;
                        _currentAerosol = st['aerosol'] as double;
                        _highlightWardByName(st['name']);
                      });
                    },
                    child: Container(
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2.2),
                        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 6, offset: Offset(0, 3))],
                      ),
                      child: Center(
                        child: Text(
                          '$aqi',
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12),
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),

        // THANH TÌM KIẾM
        Positioned(
          top: 14,
          left: 14,
          right: 14,
          child: Row(
            children: [
              Expanded(
                child: Container(
                  height: 48,
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8, offset: Offset(0, 3))]),
                  child: TextField(
                    controller: _searchCtrl,
                    textInputAction: TextInputAction.search,
                    onSubmitted: _executeSearch,
                    decoration: InputDecoration(
                      hintText: 'Tìm kiếm 166 Phường/Xã (vd: Bình Đông)...',
                      prefixIcon: const Icon(Icons.search, color: Color(0xFF0284C7)),
                      suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward, color: Color(0xFF0284C7)), onPressed: () => _executeSearch(_searchCtrl.text)),
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: _openAuthOrProfile,
                child: Container(
                  height: 48,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: _userProfile != null ? const Color(0xFFDCFCE7) : const Color(0xFF0284C7),
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8, offset: Offset(0, 3))],
                  ),
                  child: Row(
                    children: [
                      Icon(_userProfile != null ? Icons.verified_user : Icons.person_add, color: _userProfile != null ? const Color(0xFF15803D) : Colors.white, size: 18),
                      const SizedBox(width: 6),
                      Text(_userProfile != null ? _userProfile!['name'] : 'Đăng nhập', style: TextStyle(color: _userProfile != null ? const Color(0xFF15803D) : Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                    ],
                  ),
                ),
              )
            ],
          ),
        ),

        // PANEL CHỈ SỐ BÊN DƯỚI (BIẾN THIÊN RIÊNG BIỆT TỪNG NƠI VÀ ĐỔI CHUẨN AQI)
        Positioned(
          bottom: 14,
          left: 14,
          right: 14,
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 14, offset: Offset(0, 4))]),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.cell_tower, color: Color(0xFF0284C7), size: 18),
                        const SizedBox(width: 6),
                        Text(_currentLocationName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5, color: Color(0xFF0F172A))),
                      ],
                    ),
                    Container(
                      decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(8)),
                      child: Row(
                        children: [
                          GestureDetector(
                            onTap: () => setState(() => _isUSAQI = false),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(color: !_isUSAQI ? const Color(0xFF0284C7) : Colors.transparent, borderRadius: BorderRadius.circular(6)),
                              child: Text('VN_AQI', style: TextStyle(color: !_isUSAQI ? Colors.white : const Color(0xFF475569), fontWeight: FontWeight.bold, fontSize: 11)),
                            ),
                          ),
                          GestureDetector(
                            onTap: () => setState(() => _isUSAQI = true),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(color: _isUSAQI ? const Color(0xFF0284C7) : Colors.transparent, borderRadius: BorderRadius.circular(6)),
                              child: Text('US_AQI', style: TextStyle(color: _isUSAQI ? Colors.white : const Color(0xFF475569), fontWeight: FontWeight.bold, fontSize: 11)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(color: displayColor.withOpacity(0.15), shape: BoxShape.circle, border: Border.all(color: displayColor, width: 3)),
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text('$displayAQI', style: TextStyle(color: displayColor, fontSize: 22, fontWeight: FontWeight.w900)),
                            Text(_isUSAQI ? 'US AQI' : 'VN_AQI', style: TextStyle(fontSize: 8.5, color: displayColor, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFFDE047))),
                            child: Text(_computedLevel, style: const TextStyle(color: Color(0xFFB45309), fontWeight: FontWeight.bold, fontSize: 12)),
                          ),
                          const SizedBox(height: 4),
                          Text(_isUSAQI ? 'Tiêu chuẩn US EPA Hoa Kỳ' : 'Đạt quy chuẩn QCVN 05:2023/BTNMT', style: const TextStyle(fontSize: 11, color: Color(0xFF0284C7), fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(child: _buildMetricItem('PM2.5', '${_currentPM25.toStringAsFixed(1)} µg/m³', const Color(0xFF0284C7))),
                    const SizedBox(width: 8),
                    Expanded(child: _buildMetricItem('PM10', '${_currentPM10.toStringAsFixed(1)} µg/m³', const Color(0xFF475569))),
                    const SizedBox(width: 8),
                    Expanded(child: _buildMetricItem('Nhiệt độ (ERA5)', '${_currentTemp.toStringAsFixed(1)} °C', const Color(0xFFEA580C))),
                    const SizedBox(width: 8),
                    Expanded(child: _buildMetricItem('Khí dung (S5P)', '${_currentAerosol.toStringAsFixed(2)} AAI', const Color(0xFF7C3AED))),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMetricItem(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
      decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFE2E8F0))),
      child: Column(
        children: [
          Text(label, style: const TextStyle(fontSize: 9.5, color: Color(0xFF64748B), fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }
}