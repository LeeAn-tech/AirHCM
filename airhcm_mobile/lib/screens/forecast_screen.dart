import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';

class ForecastAIScreen extends StatefulWidget {
  const ForecastAIScreen({super.key});

  @override
  State<ForecastAIScreen> createState() => _ForecastAIScreenState();
}

class _ForecastAIScreenState extends State<ForecastAIScreen> {
  int _selectedHours = 24;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dự Báo AI & Học Máy', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        backgroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [24, 72, 168].map((h) {
                final isSelected = _selectedHours == h;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(h == 168 ? '7 Ngày tới' : '$h Giờ tới'),
                    selected: isSelected,
                    selectedColor: const Color(0xFF0284C7),
                    labelStyle: TextStyle(color: isSelected ? Colors.white : const Color(0xFF475569), fontWeight: FontWeight.bold),
                    onSelected: (val) => setState(() => _selectedHours = h),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
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
                  const Text('Biến thiên nồng độ PM2.5 (µg/m³)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 180,
                    child: LineChart(
                      LineChartData(
                        gridData: const FlGridData(show: true, drawVerticalLine: false),
                        titlesData: const FlTitlesData(
                          rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                          topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        ),
                        borderData: FlBorderData(show: false),
                        lineBarsData: [
                          LineChartBarData(
                            spots: const [
                              FlSpot(0.0, 22.0),
                              FlSpot(3.0, 38.0),
                              FlSpot(6.0, 46.0),
                              FlSpot(9.0, 28.0),
                              FlSpot(12.0, 18.0),
                              FlSpot(15.0, 24.0),
                              FlSpot(18.0, 42.0),
                              FlSpot(21.0, 30.0),
                              FlSpot(24.0, 25.0),
                            ],
                            isCurved: true,
                            color: const Color(0xFF0284C7),
                            barWidth: 3,
                            // Đã sửa lỗi: Dùng mã màu hex 12% hợp lệ tuyệt đối cho const
                            belowBarData: BarAreaData(
                              show: true,
                              color: const Color(0x1F0284C7),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text('Đỉnh cao điểm: 46 µg/m³ (07:00 sáng) • Đáy phân tán: 18 µg/m³ (12:00 trưa)', style: TextStyle(fontSize: 11.5, color: Color(0xFF64748B))),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const Text('Đối Soát Thuật Toán Học Máy', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _buildAlgorithmCard(
                    title: 'Random Forest',
                    r2: '0.879 (87.9%)',
                    rmse: '5.71 µg/m³',
                    mae: '4.36 µg/m³',
                    isBest: true,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildAlgorithmCard(
                    title: 'AdaBoost Regressor',
                    r2: '0.812 (81.2%)',
                    rmse: '7.14 µg/m³',
                    mae: '5.82 µg/m³',
                    isBest: false,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
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
                  const Text('Tầm Quan Trọng Đặc Trưng (XAI)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                  const SizedBox(height: 12),
                  _buildFeatureBar('Nồng độ nền 7 ngày trước', 0.74, '74.0%', const Color(0xFF0284C7)),
                  _buildFeatureBar('Tốc độ gió 10m & Hệ số khuếch tán', 0.136, '13.6%', const Color(0xFF10B981)),
                  _buildFeatureBar('Biến trễ PM2.5 (t-1, t-24)', 0.052, '5.2%', const Color(0xFFF59E0B)),
                  _buildFeatureBar('Nhiệt độ bề mặt 2m', 0.048, '4.8%', const Color(0xFFEF4444)),
                  _buildFeatureBar('Sol khí Sentinel-5P (AAI)', 0.024, '2.4%', const Color(0xFF8B5CF6)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAlgorithmCard({required String title, required String r2, required String rmse, required String mae, required bool isBest}) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isBest ? const Color(0xFF0284C7) : const Color(0xFFCBD5E1), width: isBest ? 2 : 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              if (isBest) const Icon(Icons.check_circle, color: Color(0xFF0284C7), size: 16),
            ],
          ),
          const SizedBox(height: 8),
          Text('R²: $r2', style: TextStyle(fontWeight: FontWeight.bold, color: isBest ? const Color(0xFF0284C7) : Colors.black87, fontSize: 13)),
          Text('RMSE: $rmse', style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B))),
          Text('MAE: $mae', style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B))),
        ],
      ),
    );
  }

  Widget _buildFeatureBar(String label, double ratio, String percent, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF334155))),
              Text(percent, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 4),
          LinearProgressIndicator(value: ratio, color: color, backgroundColor: const Color(0xFFF1F5F9), minHeight: 6),
        ],
      ),
    );
  }
}