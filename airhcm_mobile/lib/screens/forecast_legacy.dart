import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../core/api_service.dart';
import '../core/app_state.dart';
import '../core/aqi_utils.dart';
import '../widgets/ui.dart';

/// Dự báo PM2.5 bản cũ (/forecast/hourly) - chỉ dùng khi máy chủ chưa có dữ liệu đa chất (AirData)
class LegacyForecastScreen extends StatefulWidget {
  const LegacyForecastScreen({super.key});

  @override
  State<LegacyForecastScreen> createState() => _LegacyForecastScreenState();
}

class _LegacyForecastScreenState extends State<LegacyForecastScreen> {
  /// QCVN 05:2023/BTNMT: PM2.5 TB 24h = 45 µg/m³ từ 01/01/2026
  static const double _qcvn = 45.0;

  int _hours = 24;
  List<Map<String, dynamic>> _data = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    AppState.useUSAQI.addListener(_refresh);
    AppState.alert.addListener(_refresh);
    _load();
  }

  @override
  void dispose() {
    AppState.useUSAQI.removeListener(_refresh);
    AppState.alert.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await ApiService.forecast(_hours);
      _data = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _loading = false);
  }

  double _pm(Map<String, dynamic> item) => AqiUtils.toDouble(item['pm2_5']);

  String _timeLabel(String raw, {bool withDate = false}) {
    // "2026-11-10 07:00" -> "07:00" / "07:00 10/11"
    final parts = raw.split(' ');
    if (parts.length < 2) return raw;
    final d = parts[0].split('-');
    return withDate && d.length == 3 ? '${parts[1]} ${d[2]}/${d[1]}' : parts[1];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dự báo PM2.5 (bản cũ)', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        actions: [IconButton(tooltip: 'Làm mới', onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: [
            Row(
              children: [24, 72, 168].map((h) {
                final selected = _hours == h;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(h == 168 ? '7 ngày' : '$h giờ'),
                    selected: selected,
                    onSelected: (_) {
                      setState(() => _hours = h);
                      _load();
                    },
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            AlertStatusCard(alert: AppState.alert.value, compact: true, onTap: () => AppState.tabIndex.value = 3),
            const SizedBox(height: 12),
            if (_loading)
              const Padding(padding: EdgeInsets.symmetric(vertical: 60), child: Center(child: CircularProgressIndicator()))
            else if (_error != null)
              ErrorView(message: _error!, onRetry: _load)
            else if (_data.isEmpty)
              const Center(child: Text('Chưa có dữ liệu dự báo.'))
            else ...[
              _kpis(),
              const SizedBox(height: 12),
              _chartCard(),
              const SizedBox(height: 12),
              _hourlyList(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _kpis() {
    final useUS = AppState.useUSAQI.value;
    final peak = _data.reduce((a, b) => _pm(a) >= _pm(b) ? a : b);
    final low = _data.reduce((a, b) => _pm(a) <= _pm(b) ? a : b);
    final exceed = _data.where((e) => _pm(e) > _qcvn).length;
    final peakAqi = AqiUtils.compute(_pm(peak), useUS: useUS);

    Widget tile(String label, String value, String sub, Color color, IconData icon) => Expanded(
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: color, size: 20),
                const SizedBox(height: 6),
                Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.muted)),
                Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: color)),
                Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
              ],
            ),
          ),
        );

    return Column(
      children: [
        Row(children: [
          tile('ĐỈNH PM2.5', _pm(peak).toStringAsFixed(1), _timeLabel('${peak['time']}', withDate: true), AppColors.danger, Icons.trending_up),
          const SizedBox(width: 8),
          tile('THẤP NHẤT', _pm(low).toStringAsFixed(1), _timeLabel('${low['time']}', withDate: true), AppColors.success, Icons.trending_down),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          tile('${AqiUtils.standardLabel(useUS)} ĐỈNH', '$peakAqi', AqiUtils.level(peakAqi), AqiUtils.strong(peakAqi), Icons.speed),
          const SizedBox(width: 8),
          tile('GIỜ VƯỢT QCVN', '$exceed giờ', 'Ngưỡng 45 µg/m³', exceed > 0 ? AppColors.danger : AppColors.brand, Icons.timer_outlined),
        ]),
      ],
    );
  }

  Widget _chartCard() {
    final spots = <FlSpot>[for (var i = 0; i < _data.length; i++) FlSpot(i.toDouble(), _pm(_data[i]))];
    final maxY = math.max(60.0, spots.map((s) => s.y).reduce(math.max) * 1.15);
    final labelEvery = _hours <= 24 ? 4 : (_hours <= 72 ? 12 : 24);

    return SectionCard(
      title: 'Biến thiên nồng độ PM2.5',
      subtitle: 'Đường đỏ: ngưỡng QCVN 05:2023 (45 µg/m³)',
      icon: Icons.show_chart,
      child: SizedBox(
        height: 220,
        child: LineChart(
          LineChartData(
            minY: 0,
            maxY: maxY,
            gridData: FlGridData(
              show: true,
              drawVerticalLine: false,
              horizontalInterval: maxY / 4,
              getDrawingHorizontalLine: (_) => const FlLine(color: Color(0x1F94A3B8), strokeWidth: 1),
            ),
            borderData: FlBorderData(show: false),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 34,
                  interval: maxY / 4,
                  getTitlesWidget: (v, meta) => SideTitleWidget(
                    axisSide: meta.axisSide,
                    child: Text(v.toStringAsFixed(0), style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ),
                ),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 24,
                  interval: 1,
                  getTitlesWidget: (v, meta) {
                    final i = v.toInt();
                    if (i < 0 || i >= _data.length || i % labelEvery != 0) return const SizedBox.shrink();
                    final label = _timeLabel('${_data[i]['time']}', withDate: _hours > 24);
                    return SideTitleWidget(
                      axisSide: meta.axisSide,
                      child: Text(_hours > 24 ? label.split(' ').last : label, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                    );
                  },
                ),
              ),
            ),
            extraLinesData: ExtraLinesData(horizontalLines: [
              HorizontalLine(
                y: _qcvn,
                color: AppColors.danger.withValues(alpha: 0.75),
                strokeWidth: 1.5,
                dashArray: [6, 4],
                label: HorizontalLineLabel(
                  show: true,
                  alignment: Alignment.topRight,
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.danger),
                  labelResolver: (_) => 'QCVN 45',
                ),
              ),
            ]),
            lineTouchData: LineTouchData(
              touchTooltipData: LineTouchTooltipData(
                tooltipBgColor: const Color(0xEB0F172A),
                tooltipRoundedRadius: 10,
                getTooltipItems: (spots) => spots.map((s) {
                  final item = _data[s.x.toInt()];
                  final aqi = AqiUtils.compute(s.y, useUS: AppState.useUSAQI.value);
                  return LineTooltipItem(
                    '${_timeLabel('${item['time']}', withDate: true)}\n${s.y.toStringAsFixed(1)} µg/m³ · AQI $aqi',
                    const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 11.5),
                  );
                }).toList(),
              ),
            ),
            lineBarsData: [
              LineChartBarData(
                spots: spots,
                isCurved: true,
                curveSmoothness: 0.25,
                color: AppColors.brand,
                barWidth: 3,
                dotData: FlDotData(show: _hours <= 24),
                belowBarData: BarAreaData(
                  show: true,
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [AppColors.cyan.withValues(alpha: 0.35), AppColors.brand.withValues(alpha: 0.02)],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _hourlyList() {
    final useUS = AppState.useUSAQI.value;
    final shown = _hours <= 24 ? _data : [for (var i = 0; i < _data.length; i += 3) _data[i]];
    return SectionCard(
      title: 'Chi tiết theo giờ',
      subtitle: _hours <= 24 ? '24 mốc dự báo cuốn chiếu' : 'Mỗi 3 giờ một mốc',
      icon: Icons.table_rows_outlined,
      iconColor: AppColors.teal,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        children: shown.map((item) {
          final pm = _pm(item);
          final aqi = AqiUtils.compute(pm, useUS: useUS);
          return Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFEEF2F7)))),
            child: Row(
              children: [
                SizedBox(
                  width: 82,
                  child: Text(_timeLabel('${item['time']}', withDate: true),
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: AppColors.text)),
                ),
                Expanded(
                  child: Text('${pm.toStringAsFixed(1)} µg/m³',
                      style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: pm > _qcvn ? AppColors.danger : AppColors.brand)),
                ),
                Text('$aqi', style: TextStyle(fontWeight: FontWeight.w900, color: AqiUtils.strong(aqi))),
                const SizedBox(width: 8),
                AqiPill(aqi: aqi, dense: true),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}
