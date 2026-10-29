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
  
  // Trạng thái chuẩn AQI: false = VN_AQI, true = US_AQI
  bool _isUSAQI = false;

  // Dữ liệu thời gian thực đồng bộ từ Backend API
  int _currentAQI = 72;
  double _currentPM25 = 36.0;
  double _currentPM10 = 48.6;
  double _currentTemp = 26.4;
  double _currentAerosol = 0.74;
  String _currentLevel = 'Trung bình';
  Color _currentColor = const Color(0xFFD97706);
  String _qcvnStatus = 'Đạt quy chuẩn QCVN 05:2023';
  String _currentTimeStr = '28/10/2026 22:31:54';

  // Thông tin tài khoản đăng nhập
  Map<String, dynamic>? _userProfile;

  // Danh sách các trạm PostGIS động
  List<Map<String, dynamic>> _stations = [];

  // Danh sách ranh giới đa giác Phường/Xã TP.HCM
  List<Polygon> _wardPolygons = [];
  bool _isLoadingGeoJSON = true;

  @override
  void initState() {
    super.initState();
    _checkUserLogin();
    _fetchLiveAQIData();
    _fetchLiveStations();
    _loadWardGeoJSON();
  }

  // 1. Kiểm tra trạng thái đăng nhập
  Future<void> _checkUserLogin() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('user_session');
    if (raw != null) {
      setState(() => _userProfile = jsonDecode(raw));
    }
  }

  // 2. Lấy dữ liệu khí quyển thời gian thực từ Backend
  Future<void> _fetchLiveAQIData() async {
    try {
      final res = await http.get(Uri.parse('http://127.0.0.1:8000/api/v1/aqi/current'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() {
          _currentPM25 = double.tryParse(data['pm2_5'].toString()) ?? 36.0;
          _currentPM10 = double.tryParse(data['pm10'].toString()) ?? 48.6;
          _currentAQI = int.tryParse(data['us_aqi'].toString()) ?? 72;
          
          double t = double.tryParse(data['temperature_2m'].toString()) ?? 26.4;
          _currentTemp = t > 100 ? t - 273.15 : t;
          
          _currentAerosol = double.tryParse(data['absorbing_aerosol_index']?.toString() ?? '0.74') ?? 0.74;
          
          if (data['advisory'] != null) {
            _currentLevel = data['advisory']['level'] ?? 'Trung bình';
            _qcvnStatus = data['advisory']['qcvn_comparison'] ?? 'Đạt quy chuẩn QCVN 05:2023';
          }
          _currentColor = _getAQIColor(_currentAQI);
        });
      }
    } catch (_) {}
  }

  // 3. Lấy mạng lưới trạm từ PostGIS
  Future<void> _fetchLiveStations() async {
    try {
      final res = await http.get(Uri.parse('http://127.0.0.1:8000/api/v1/gis/stations'));
      if (res.statusCode == 200) {
        final List list = jsonDecode(res.body);
        setState(() {
          _stations = list.map((e) => {
            'name': e['ten_tram'],
            'lat': (e['lat'] as num).toDouble(),
            'lng': (e['lng'] as num).toDouble(),
            'status': e['status'] ?? 'HOẠT ĐỘNG',
            'aqi': _isUSAQI ? 72 : 70,
            'pm25': _currentPM25,
          }).toList();
        });
      }
    } catch (_) {
      // Dữ liệu dự phòng đồng bộ với Web
      setState(() {
        _stations = [
          {'name': 'Trạm Trung tâm TP.HCM', 'lat': 10.8231, 'lng': 106.6297, 'aqi': 68, 'pm25': 36.0, 'status': 'HOẠT ĐỘNG'},
          {'name': 'Trạm Bến Thành - Q.1', 'lat': 10.7769, 'lng': 106.7009, 'aqi': 78, 'pm25': 39.5, 'status': 'HOẠT ĐỘNG'},
          {'name': 'Trạm Bình Đông - Q.8', 'lat': 10.7328, 'lng': 106.6525, 'aqi': 80, 'pm25': 42.0, 'status': 'HOẠT ĐỘNG'},
          {'name': 'Trạm KCN Bình Tân', 'lat': 10.7483, 'lng': 106.6022, 'aqi': 85, 'pm25': 45.0, 'status': 'HOẠT ĐỘNG'},
          {'name': 'Trạm KĐT TP. Thủ Đức', 'lat': 10.8494, 'lng': 106.7583, 'aqi': 71, 'pm25': 35.5, 'status': 'HOẠT ĐỘNG'},
          {'name': 'Trạm Sơn Kỳ - Tân Phú', 'lat': 10.7987, 'lng': 106.6300, 'aqi': 70, 'pm25': 37.0, 'status': 'BẢO TRÌ'},
        ];
      });
    }
  }

  // 4. Nạp và giải mã GeoJSON Ranh giới 166 Phường/Xã từ máy chủ Web
  Future<void> _loadWardGeoJSON() async {
    try {
      final res = await http.get(Uri.parse('http://127.0.0.1:3000/assets/data/hcm_wards.json'));
      if (res.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(utf8.decode(res.bodyBytes));
        final List features = data['features'] ?? [];
        List<Polygon> polys = [];

        for (var f in features) {
          final geom = f['geometry'];
          if (geom == null) continue;
          final type = geom['type'];
          final coords = geom['coordinates'];

          // Màu vàng nhẹ/xanh đại diện cho mức AQI 65 - 80 của toàn TP.HCM
          final Color fillColor = const Color(0x55FACC15); // Vàng bán trong suốt
          final Color strokeColor = const Color(0xFFCA8A04); // Viền vàng đậm

          if (type == 'Polygon') {
            for (var ring in coords) {
              List<LatLng> points = [];
              for (var pt in ring) {
                points.add(LatLng((pt[1] as num).toDouble(), (pt[0] as num).toDouble()));
              }
              if (points.isNotEmpty) {
                polys.add(Polygon(
                  points: points,
                  color: fillColor,
                  borderColor: strokeColor,
                  borderStrokeWidth: 1.2,
                ));
              }
            }
          } else if (type == 'MultiPolygon') {
            for (var poly in coords) {
              for (var ring in poly) {
                List<LatLng> points = [];
                for (var pt in ring) {
                  points.add(LatLng((pt[1] as num).toDouble(), (pt[0] as num).toDouble()));
                }
                if (points.isNotEmpty) {
                  polys.add(Polygon(
                    points: points,
                    color: fillColor,
                    borderColor: strokeColor,
                    borderStrokeWidth: 1.2,
                  ));
                }
              }
            }
          }
        }

        if (mounted) {
          setState(() {
            _wardPolygons = polys;
            _isLoadingGeoJSON = false;
          });
        }
      }
    } catch (e) {
      if (mounted) setState(() => _isLoadingGeoJSON = false);
    }
  }

  Color _getAQIColor(int aqi) {
    if (aqi <= 50) return const Color(0xFF16A34A);
    if (aqi <= 100) return const Color(0xFFD97706);
    if (aqi <= 150) return const Color(0xFFEA580C);
    if (aqi <= 200) return const Color(0xFFDC2626);
    return const Color(0xFF7E22CE);
  }

  void _openAuthOrProfile() {
    if (_userProfile == null) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (ctx) => AuthScreen(onLoginSuccess: _checkUserLogin)),
      );
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
                const CircleAvatar(
                  radius: 26,
                  backgroundColor: Color(0xFFE0F2FE),
                  child: Icon(Icons.person, color: Color(0xFF0284C7), size: 30),
                ),
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
            const SizedBox(height: 6),
            const Text('Quyền hạn: Tra cứu bản đồ, Dự báo AI, Thử nghiệm What-If', style: TextStyle(fontSize: 13, color: Color(0xFF475569))),
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
    return Stack(
      children: [
        // 1. LỚP BẢN ĐỒ ESRI LIGHT GRAY CANVAS NỀN SÁNG ĐỒNG BỘ WEBGIS
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
            // Lớp ranh giới 166 Phường/Xã TP.HCM
            if (_wardPolygons.isNotEmpty)
              PolygonLayer(polygons: _wardPolygons),
            // Huy hiệu các trạm quan trắc PostGIS
            MarkerLayer(
              markers: _stations.map((st) {
                final int aqi = st['aqi'] as int;
                final Color color = _getAQIColor(aqi);
                return Marker(
                  point: LatLng(st['lat'] as double, st['lng'] as double),
                  width: 38,
                  height: 38,
                  child: GestureDetector(
                    onTap: () => _showStationDetails(st),
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

        // 2. THANH TÌM KIẾM + NÚT ĐĂNG NHẬP / PROFILE TRÊN ĐỈNH
        Positioned(
          top: 14,
          left: 14,
          right: 14,
          child: Row(
            children: [
              Expanded(
                child: Container(
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8, offset: Offset(0, 3))],
                  ),
                  child: const TextField(
                    decoration: InputDecoration(
                      hintText: 'Tìm kiếm 166 Phường/Xã TP.HCM...',
                      prefixIcon: Icon(Icons.search, color: Color(0xFF0284C7)),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // Nút Đăng nhập / Đăng ký hoặc Hồ sơ thành viên
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
                      Icon(
                        _userProfile != null ? Icons.verified_user : Icons.person_add,
                        color: _userProfile != null ? const Color(0xFF15803D) : Colors.white,
                        size: 18,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        _userProfile != null ? _userProfile!['name'] : 'Đăng nhập',
                        style: TextStyle(
                          color: _userProfile != null ? const Color(0xFF15803D) : Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              )
            ],
          ),
        ),

        // 3. BẢNG ĐIỀU KHIỂN THÔNG SỐ ĐỒNG BỘ 100% VỚI WEBGIS (HÌNH 2)
        Positioned(
          bottom: 14,
          left: 14,
          right: 14,
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 14, offset: Offset(0, 4))],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Hàng tiêu đề trạm + Nút chọn chuẩn VN_AQI / US_AQI
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.cell_tower, color: Color(0xFF0284C7), size: 18),
                        SizedBox(width: 6),
                        Text('Trạm Trung tâm TP.HCM', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF0F172A))),
                      ],
                    ),
                    // Bộ nút chuyển chuẩn AQI giống hệt WebGIS ở Hình 2
                    Container(
                      decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(8)),
                      child: Row(
                        children: [
                          GestureDetector(
                            onTap: () => setState(() => _isUSAQI = false),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: !_isUSAQI ? const Color(0xFF0284C7) : Colors.transparent,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text('VN_AQI', style: TextStyle(color: !_isUSAQI ? Colors.white : const Color(0xFF475569), fontWeight: FontWeight.bold, fontSize: 11)),
                            ),
                          ),
                          GestureDetector(
                            onTap: () => setState(() => _isUSAQI = true),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _isUSAQI ? const Color(0xFF0284C7) : Colors.transparent,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text('US_AQI', style: TextStyle(color: _isUSAQI ? Colors.white : const Color(0xFF475569), fontWeight: FontWeight.bold, fontSize: 11)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // Vòng tròn AQI và Nhãn cảnh báo
                Row(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        color: _currentColor.withOpacity(0.15),
                        shape: BoxShape.circle,
                        border: Border.all(color: _currentColor, width: 3),
                      ),
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text('$_currentAQI', style: TextStyle(color: _currentColor, fontSize: 22, fontWeight: FontWeight.w900)),
                            Text(_isUSAQI ? 'US AQI' : 'VN_AQI', style: TextStyle(fontSize: 8.5, color: _currentColor, fontWeight: FontWeight.bold)),
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
                            child: Text(_currentLevel, style: const TextStyle(color: Color(0xFFB45309), fontWeight: FontWeight.bold, fontSize: 12)),
                          ),
                          const SizedBox(height: 4),
                          Text(_qcvnStatus, style: const TextStyle(fontSize: 11, color: Color(0xFF0284C7), fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),

                // 4 Ô CHỈ SỐ KHÍ TƯỢNG ĐỒNG BỘ CHÍNH XÁC VỚI WEBGIS
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

  void _showStationDetails(Map<String, dynamic> st) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(st['name'], style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: st['status'] == 'BẢO TRÌ' ? const Color(0xFFFEF3C7) : const Color(0xFFDCFCE7),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(st['status'], style: TextStyle(color: st['status'] == 'BẢO TRÌ' ? const Color(0xFFD97706) : const Color(0xFF16A34A), fontWeight: FontWeight.bold, fontSize: 11)),
                )
              ],
            ),
            const SizedBox(height: 10),
            Text('Chỉ số chất lượng không khí: ${st['aqi']}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            Text('Nồng độ PM2.5: ${st['pm25']} µg/m³', style: const TextStyle(fontSize: 13, color: Color(0xFF64748B))),
          ],
        ),
      ),
    );
  }
}