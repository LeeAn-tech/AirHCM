import 'package:flutter/material.dart';

class DSSAdvisoryScreen extends StatefulWidget {
  const DSSAdvisoryScreen({super.key});

  @override
  State<DSSAdvisoryScreen> createState() => _DSSAdvisoryScreenState();
}

class _DSSAdvisoryScreenState extends State<DSSAdvisoryScreen> {
  double _traffic = 0.0;
  double _temperature = 0.0;
  double _wind = 1.0;

  double get _simulatedPM25 {
    return 20.5 * (1.0 + (_traffic / 100) * 0.7) * (1.0 - _temperature * 0.02) * (1.0 / _wind);
  }

  int get _simulatedAQI {
    final pm = _simulatedPM25;
    if (pm <= 12.0) return (pm * 50 / 12.0).round();
    if (pm <= 35.4) return (((pm - 12.0) / 23.4) * 49 + 51).round();
    return (((pm - 35.4) / 20.0) * 49 + 101).round();
  }

  @override
  Widget build(BuildContext context) {
    final aqi = _simulatedAQI;
    final pm = _simulatedPM25;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tư Vấn Y Tế & Kịch Bản What-If', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        backgroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.tune, color: Color(0xFF0284C7)),
                      SizedBox(width: 8),
                      Text('Mô Phỏng Kịch Bản Vi Khí Hậu (What-If)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text('Lưu lượng xe: ${_traffic > 0 ? "+$_traffic%" : "$_traffic%"}'),
                  Slider(
                    value: _traffic,
                    min: -50,
                    max: 100,
                    divisions: 15,
                    activeColor: const Color(0xFF0284C7),
                    onChanged: (v) => setState(() => _traffic = v),
                  ),
                  Text('Biến thiên nhiệt độ: ${_temperature > 0 ? "+$_temperature°C" : "$_temperature°C"}'),
                  Slider(
                    value: _temperature,
                    min: -5,
                    max: 5,
                    divisions: 10,
                    activeColor: const Color(0xFFEF4444),
                    onChanged: (v) => setState(() => _temperature = v),
                  ),
                  Text('Hệ số tốc độ gió: ${_wind.toStringAsFixed(1)}x'),
                  Slider(
                    value: _wind,
                    min: 0.5,
                    max: 2.0,
                    divisions: 15,
                    activeColor: const Color(0xFF10B981),
                    onChanged: (v) => setState(() => _wind = v),
                  ),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(10)),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        Text('PM2.5: ${pm.toStringAsFixed(1)} µg/m³', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0284C7))),
                        Text('AQI: $aqi (${aqi <= 50 ? "Tốt" : aqi <= 100 ? "Trung bình" : "Kém"})', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFD97706))),
                      ],
                    ),
                  )
                ],
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: const Color(0xFFECFDF5), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFA7F3D0))),
              child: const Row(
                children: [
                  Icon(Icons.wb_sunny_outlined, color: Color(0xFF059669), size: 36),
                  SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Khung Giờ Khuyên Dùng Ngoài Trời', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF065F46))),
                        SizedBox(height: 4),
                        Text('10:00 - 15:00: Đối lưu khí quyển diễn ra tốt, thích hợp thông gió và sinh hoạt.', style: TextStyle(fontSize: 12.5, color: Color(0xFF047857))),
                      ],
                    ),
                  )
                ],
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFFECACA))),
              child: const Row(
                children: [
                  Icon(Icons.warning_amber_rounded, color: Color(0xFFDC2626), size: 36),
                  SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Khung Giờ Cảnh Báo Ô Nhiễm', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF991B1B))),
                        SizedBox(height: 4),
                        Text('06:30 - 08:30 & 17:00 - 19:00: Ùn tắc giao thông kết hợp nghịch nhiệt, cần đeo khẩu trang N95.', style: TextStyle(fontSize: 12.5, color: Color(0xFFB91C1C))),
                      ],
                    ),
                  )
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}