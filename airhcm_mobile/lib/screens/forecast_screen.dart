import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../core/api_service.dart';
import '../core/app_state.dart';
import '../core/aqi_utils.dart';
import '../widgets/ui.dart';
import '../widgets/ward_picker.dart';
import 'forecast_legacy.dart';

/// Dự báo realtime đa chất (đồng bộ tab "Dự báo AI" của WebGIS - /air/forecast):
/// mở app là có ngày hiện tại + chỉ số giờ hiện tại, 8 thẻ ngày (hôm nay + 7 ngày tới),
/// biểu đồ theo giờ từng chất, xu hướng các tháng tới và kết quả kiểm thử mô hình.
class ForecastAIScreen extends StatefulWidget {
  const ForecastAIScreen({super.key});

  @override
  State<ForecastAIScreen> createState() => _ForecastAIScreenState();
}

class _ForecastAIScreenState extends State<ForecastAIScreen> {
  static const _order = ['pm2_5', 'pm10', 'co', 'no2', 'so2', 'o3', 'co2'];
  static const _names = {
    'pm2_5': 'PM2.5', 'pm10': 'PM10', 'co': 'CO', 'no2': 'NO2', 'so2': 'SO2', 'o3': 'O3', 'co2': 'CO2',
  };
  static const _colors = {
    'pm2_5': Color(0xFF0284C7), 'pm10': Color(0xFF0D9488), 'co': Color(0xFF7C3AED), 'no2': Color(0xFFDC2626),
    'so2': Color(0xFFD97706), 'o3': Color(0xFF16A34A), 'co2': Color(0xFF475569),
  };

  Map<String, dynamic>? _data;
  Map<String, dynamic>? _metrics;
  String _pollutant = 'pm2_5';
  int _range = 24;
  String _scope = 'city'; // city | gps | ward
  String? _wardCode;
  String? _wardName;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    AppState.useUSAQI.addListener(_refresh);
    AppState.alert.addListener(_refresh);
    final home = AppState.area('home');
    if (home != null) {
      _scope = 'ward';
      _wardCode = '${home['code']}';
      _wardName = '${home['name'] ?? ''}';
    }
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
      final loc = AppState.lastLocation.value;
      _data = await ApiService.airForecast(
        wardCode: _scope == 'ward' ? _wardCode : null,
        lat: _scope == 'gps' ? loc?.latitude : null,
        lng: _scope == 'gps' ? loc?.longitude : null,
      );
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _loading = false);
    if (_metrics == null) {
      try {
        _metrics = await ApiService.airModelMetrics();
        if (mounted) setState(() {});
      } catch (_) {/* chưa huấn luyện -> thẻ mô hình hiển thị theo payload */}
    }
  }

  // ------------------------------------------------------------------ tiện ích
  String get _std => AppState.useUSAQI.value ? 'us' : 'vn';
  String _unit(String p) => p == 'co2' ? 'ppm' : 'µg/m³';
  double? _num(dynamic v) => v is num ? v.toDouble() : double.tryParse('${v ?? ''}');
  String _fmt(dynamic v, [int nd = 1]) {
    final d = _num(v);
    if (d == null) return '--';
    return d.toStringAsFixed(nd).replaceAll('.', ',');
  }

  int? _aqiOf(Map row) {
    final v = row['${_std}_aqi'];
    return v is num ? v.toInt() : null;
  }

  List<Map<String, dynamic>> get _hourly =>
      ((_data?['hourly'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  List<Map<String, dynamic>> get _daily =>
      ((_data?['daily'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  double? _limit(String p) {
    final pol = (_data?['pollutants'] as Map?)?[p] as Map?;
    final q = pol?['qcvn'] as Map?;
    if (q == null) return null;
    return _num(p.startsWith('pm') ? q['24h'] : q['1h']);
  }

  // ------------------------------------------------------------------ giao diện
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dự báo đa chất 7 ngày', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        actions: [IconButton(tooltip: 'Làm mới', onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: [
            _scopeChips(),
            const SizedBox(height: 10),
            AlertStatusCard(alert: AppState.alert.value, compact: true, onTap: () => AppState.tabIndex.value = 3),
            const SizedBox(height: 12),
            if (_loading)
              const Padding(padding: EdgeInsets.symmetric(vertical: 60), child: Center(child: CircularProgressIndicator()))
            else if (_error != null)
              _errorCard()
            else if (_data == null || _data!['ok'] != true)
              const Center(child: Text('Chưa có dữ liệu dự báo.'))
            else ...[
              _todayCard(),
              const SizedBox(height: 12),
              _daysCard(),
              const SizedBox(height: 12),
              _chartCard(),
              const SizedBox(height: 12),
              _monthlyCard(),
              const SizedBox(height: 12),
              _modelCard(),
              const SizedBox(height: 12),
              _hourlyList(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _scopeChips() {
    Widget chip(String label, IconData icon, bool selected, VoidCallback onTap) => Padding(
          padding: const EdgeInsets.only(right: 8),
          child: ChoiceChip(
            avatar: Icon(icon, size: 16, color: selected ? Colors.white : AppColors.brand),
            label: Text(label, overflow: TextOverflow.ellipsis),
            selected: selected,
            selectedColor: AppColors.brand,
            labelStyle: TextStyle(color: selected ? Colors.white : AppColors.text2, fontWeight: FontWeight.w700),
            showCheckmark: false,
            onSelected: (_) => onTap(),
          ),
        );
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        chip('Toàn TP', Icons.location_city, _scope == 'city', () {
          _scope = 'city';
          _load();
        }),
        if (AppState.lastLocation.value != null)
          chip('Vị trí của tôi', Icons.my_location, _scope == 'gps', () {
            _scope = 'gps';
            _load();
          }),
        chip(_scope == 'ward' && (_wardName ?? '').isNotEmpty ? _wardName! : 'Chọn phường/xã', Icons.place_outlined,
            _scope == 'ward', () async {
          final pick = await WardPickerSheet.show(context,
              title: 'Xem dự báo của phường/xã', icon: Icons.place_outlined, selectedCode: _wardCode);
          if (pick == null) return;
          if (pick.ward == null) {
            _scope = 'city';
          } else {
            _scope = 'ward';
            _wardCode = pick.ward!.code;
            _wardName = pick.ward!.displayName;
          }
          _load();
        }),
      ]),
    );
  }

  Widget _errorCard() {
    return SectionCard(
      title: 'Chưa có dữ liệu dự báo đa chất',
      subtitle: _error,
      icon: Icons.cloud_off_outlined,
      iconColor: AppColors.danger,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Máy chủ cần nạp dữ liệu đồng nhất (scripts/airdata_backfill.py) trước khi dự báo đa chất. '
            'Trong lúc chờ, bạn có thể xem dự báo PM2.5 bản cũ.',
            style: TextStyle(fontSize: 12.5, color: AppColors.text2),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Thử lại'))),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LegacyForecastScreen())),
                icon: const Icon(Icons.show_chart),
                label: const Text('PM2.5 bản cũ'),
              ),
            ),
          ]),
        ],
      ),
    );
  }

  Widget _todayCard() {
    final today = Map<String, dynamic>.from(_data!['today'] as Map);
    final loc = Map<String, dynamic>.from(_data!['location'] as Map);
    final cur = Map<String, dynamic>.from(_data!['current'] as Map);
    final values = Map<String, dynamic>.from(cur['values'] as Map);
    final aqi = _aqiOf(cur) ?? 0;
    final dom = cur['${_std}_dominant'];
    final weather = Map<String, dynamic>.from((cur['weather'] as Map?) ?? const {});

    Widget tile(String p) {
      final v = _num(values[p]);
      final lim = _limit(p);
      final ratio = (lim != null && v != null) ? (v / lim).clamp(0.0, 1.0) : 0.0;
      final barColor = ratio >= 1 ? AppColors.danger : (ratio >= .6 ? const Color(0xFFF59E0B) : AppColors.success);
      final selected = p == _pollutant;
      return GestureDetector(
        onTap: () => setState(() => _pollutant = p),
        child: Container(
          width: 104,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? AppColors.brand : AppColors.line, width: selected ? 2 : 1),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(_names[p]!, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.muted)),
              if (dom == p) ...[
                const Spacer(),
                const Icon(Icons.star_rounded, size: 14, color: Color(0xFFD97706)),
              ],
            ]),
            const SizedBox(height: 2),
            Text(_fmt(v, p == 'co' ? 0 : 1), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.text)),
            Text(_unit(p), style: const TextStyle(fontSize: 10, color: AppColors.muted)),
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(value: ratio, minHeight: 4, color: barColor, backgroundColor: const Color(0xFFF1F5F9)),
            ),
          ]),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: .08), borderRadius: BorderRadius.circular(99)),
          child: Text('${today['label']} · ${today['now']}',
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.brand)),
        ),
        const SizedBox(height: 6),
        Text('${loc['ten_phuong_xa'] ?? 'TP. Hồ Chí Minh'}',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.text)),
        Text(loc['scope'] == 'ward' ? 'Số liệu đồng nhất của phường/xã · cập nhật mỗi giờ' : 'Trung bình 168 phường/xã · cập nhật mỗi giờ',
            style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        const SizedBox(height: 12),
        Row(children: [
          Container(
            width: 104,
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: AqiUtils.chipBg(aqi),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AqiUtils.color(aqi), width: 2),
            ),
            child: Column(children: [
              Text('${_aqiOf(cur) ?? '--'}', style: TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: AqiUtils.chipFg(aqi))),
              Text(AqiUtils.standardLabel(AppState.useUSAQI.value),
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.text2)),
            ]),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(AqiUtils.level(aqi), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AqiUtils.strong(aqi))),
              if (dom != null)
                Text('Chất chi phối: ${_names[dom] ?? dom}', style: const TextStyle(fontSize: 12.5, color: AppColors.text2)),
              if (weather.isNotEmpty)
                Text('${_fmt(weather['temperature_2m'])} °C · ẩm ${_fmt(weather['relative_humidity'], 0)}% · gió ${_fmt(weather['wind_speed'])} m/s',
                    style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            ]),
          ),
        ]),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [for (final p in _order) if (values.containsKey(p)) tile(p)]),
      ]),
    );
  }

  Widget _daysCard() {
    final days = _daily;
    return SectionCard(
      title: 'Hôm nay và 7 ngày tới',
      subtitle: 'AQI ngày đa chất · ${_names[_pollutant]} trung bình / cao nhất',
      icon: Icons.calendar_month_outlined,
      child: SizedBox(
        height: 176,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: days.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final d = days[i];
            final aqi = _aqiOf(d) ?? 0;
            final p = Map<String, dynamic>.from((d[_pollutant] as Map?) ?? const {});
            final exceed = (d['qcvn_exceed'] as List?) ?? const [];
            return Container(
              width: 118,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: i == 0 ? AppColors.brand : AppColors.line, width: i == 0 ? 2 : 1),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${d['label']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppColors.text)),
                Text(i < 2 ? '${d['weekday']} · ${d['date_label']}' : '${d['date_label']}',
                    style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                const SizedBox(height: 6),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  decoration: BoxDecoration(color: AqiUtils.chipBg(aqi), borderRadius: BorderRadius.circular(10)),
                  child: Text('${_aqiOf(d) ?? '--'}',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AqiUtils.chipFg(aqi))),
                ),
                const SizedBox(height: 4),
                Text(
                    '${AqiUtils.shortLevel(aqi)}${d['${_std}_dominant'] != null ? ' · ${_names[d['${_std}_dominant']] ?? ''}' : ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AqiUtils.strong(aqi))),
                const Spacer(),
                Text('TB ${_fmt(p['mean'])} · max ${_fmt(p['max'])}',
                    style: const TextStyle(fontSize: 10.5, color: AppColors.text2, fontWeight: FontWeight.w700)),
                if (exceed.isNotEmpty)
                  const Text('⚠ Vượt QCVN', style: TextStyle(fontSize: 10.5, color: AppColors.danger, fontWeight: FontWeight.w800)),
              ]),
            );
          },
        ),
      ),
    );
  }

  Widget _pollutantChips() => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final p in _order)
            if (((_data?['pollutants'] as Map?) ?? const {}).containsKey(p))
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  label: Text(_names[p]!),
                  selected: _pollutant == p,
                  showCheckmark: false,
                  selectedColor: _colors[p],
                  labelStyle: TextStyle(color: _pollutant == p ? Colors.white : AppColors.text2, fontWeight: FontWeight.w800),
                  onSelected: (_) => setState(() => _pollutant = p),
                ),
              ),
        ]),
      );

  Widget _chartCard() {
    final rows = _hourly.take(_range).toList();
    final p = _pollutant;
    final color = _colors[p]!;
    var lastObs = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]['observed'] == true) lastObs = i;
    }
    final obs = <FlSpot>[];
    final fc = <FlSpot>[];
    for (var i = 0; i < rows.length; i++) {
      final v = _num(rows[i][p]);
      if (v == null) continue;
      if (rows[i]['observed'] == true) obs.add(FlSpot(i.toDouble(), v));
      if (rows[i]['observed'] != true || i == lastObs) fc.add(FlSpot(i.toDouble(), v));
    }
    final all = [...obs, ...fc].map((s) => s.y);
    final limit = _limit(p);
    final top = all.isEmpty ? 10.0 : all.reduce(math.max);
    final maxY = math.max(top * 1.15, limit != null && limit < top * 2 ? limit * 1.1 : 0.0) + 0.001;
    final labelEvery = _range <= 24 ? 4 : (_range <= 72 ? 12 : 24);

    String label(int i) {
      final t = '${rows[i]['time']}';
      return _range <= 24 ? t.substring(11, 16) : '${t.substring(8, 10)}/${t.substring(5, 7)}';
    }

    return SectionCard(
      title: '${_names[p]} theo giờ',
      subtitle: 'Liền: đã có số liệu · Đứt: dự báo${limit != null ? ' · Đỏ: QCVN ${_fmt(limit, 0)} ${_unit(p)}' : ''}',
      icon: Icons.show_chart,
      child: Column(children: [
        _pollutantChips(),
        const SizedBox(height: 8),
        Row(children: [
          for (final r in const [24, 72, 192])
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                label: Text(r == 24 ? 'Hôm nay' : (r == 72 ? '3 ngày' : '8 ngày')),
                selected: _range == r,
                onSelected: (_) => setState(() => _range = r),
              ),
            ),
        ]),
        const SizedBox(height: 10),
        SizedBox(
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
                    reservedSize: 40,
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
                      if (i < 0 || i >= rows.length || i % labelEvery != 0) return const SizedBox.shrink();
                      return SideTitleWidget(
                        axisSide: meta.axisSide,
                        child: Text(label(i), style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                      );
                    },
                  ),
                ),
              ),
              extraLinesData: ExtraLinesData(horizontalLines: [
                if (limit != null && limit <= maxY)
                  HorizontalLine(y: limit, color: AppColors.danger.withValues(alpha: .75), strokeWidth: 1.5, dashArray: [6, 4]),
              ]),
              lineTouchData: LineTouchData(
                touchTooltipData: LineTouchTooltipData(
                  tooltipBgColor: const Color(0xEB0F172A),
                  tooltipRoundedRadius: 10,
                  getTooltipItems: (spots) => spots.map((s) {
                    final r = rows[s.x.toInt()];
                    final aqi = _aqiOf(r);
                    return LineTooltipItem(
                      '${'${r['time']}'.substring(5).replaceAll('-', '/')}\n${_fmt(s.y)} ${_unit(p)}${aqi != null ? ' · AQI $aqi' : ''}',
                      const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 11.5),
                    );
                  }).toList(),
                ),
              ),
              lineBarsData: [
                LineChartBarData(
                  spots: obs,
                  isCurved: true,
                  curveSmoothness: 0.2,
                  color: color,
                  barWidth: 3,
                  dotData: FlDotData(show: false),
                  belowBarData: BarAreaData(show: true, color: color.withValues(alpha: .12)),
                ),
                LineChartBarData(
                  spots: fc,
                  isCurved: true,
                  curveSmoothness: 0.2,
                  color: color,
                  barWidth: 2.5,
                  dashArray: [6, 4],
                  dotData: FlDotData(show: false),
                ),
              ],
            ),
          ),
        ),
      ]),
    );
  }

  Widget _monthlyCard() {
    final monthly = Map<String, dynamic>.from((_data!['monthly'] as Map?) ?? const {});
    final months = ((monthly['months'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final p = _pollutant;
    final rows = months.where((m) => m[p] is Map).toList();
    final bt = ((monthly['backtest'] as Map?) ?? const {})[p] as Map?;
    if (rows.isEmpty) {
      return const SectionCard(
        title: 'Xu hướng các tháng tới',
        subtitle: 'Chưa đủ 12 tháng dữ liệu để ước lượng.',
        icon: Icons.bar_chart,
        child: SizedBox.shrink(),
      );
    }
    final double hiMax = rows.map((m) => _num((m[p] as Map)['hi']) ?? 0.0).reduce(math.max);
    return SectionCard(
      title: 'Xu hướng các tháng tới (tham khảo)',
      subtitle: '${_names[p]} trung bình tháng · khoảng tin cậy 80%'
          '${bt != null && bt['available'] == true ? ' · kiểm chứng: MAE ${_fmt(bt['mae'], 2)} (khí hậu ${_fmt(bt['mae_climatology'], 2)})' : ''}',
      icon: Icons.bar_chart,
      iconColor: AppColors.teal,
      child: Column(
        children: rows.map((m) {
          final v = Map<String, dynamic>.from(m[p] as Map);
          final double mean = _num(v['mean']) ?? 0.0, lo = _num(v['lo']) ?? 0.0, hi = _num(v['hi']) ?? 0.0;
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text('${m['label']}${v.containsKey('observed_so_far') ? ' (đang diễn ra)' : ''}',
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.text)),
                ),
                Text('${_fmt(mean)} ${_unit(p)}',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: _colors[p])),
              ]),
              const SizedBox(height: 4),
              LayoutBuilder(builder: (_, c) {
                final w = c.maxWidth;
                double x(double val) => hiMax <= 0 ? 0.0 : (val / hiMax).clamp(0.0, 1.0) * w;
                return SizedBox(
                  height: 10,
                  child: Stack(children: [
                    Container(height: 10, decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(6))),
                    Positioned(
                      left: x(lo),
                      width: math.max(2.0, x(hi) - x(lo)),
                      top: 0,
                      bottom: 0,
                      child: Container(
                          decoration: BoxDecoration(color: _colors[p]!.withValues(alpha: .3), borderRadius: BorderRadius.circular(6))),
                    ),
                    Positioned(
                      left: math.max(0.0, x(mean) - 2),
                      width: 4,
                      top: 0,
                      bottom: 0,
                      child: Container(color: _colors[p]),
                    ),
                  ]),
                );
              }),
              Text('Khoảng ${_fmt(lo)} – ${_fmt(hi)} · khí hậu nhiều năm ${_fmt(v['climatology'])}',
                  style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
            ]),
          );
        }).toList(),
      ),
    );
  }

  Widget _modelCard() {
    final p = _pollutant;
    final info = Map<String, dynamic>.from((((_data!['model'] as Map?) ?? const {})[p] as Map?) ?? const {});
    final met = (_metrics?[p] as Map?);
    final names = {'ml': 'Học máy', 'ml+cams': 'Học máy + CAMS', 'cams': 'CAMS (mô hình vật lý)', 'climatology': 'Khí hậu'};
    final children = <Widget>[
      Text('Nguồn dự báo: ${names[info['source']] ?? info['source'] ?? '--'}${info['model'] != null ? ' · ${info['model']}' : ''}',
          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.text)),
    ];
    if (met != null) {
      final m = Map<String, dynamic>.from(((met['metrics'] as Map)['model'] as Map)['1-24h'] as Map);
      final b = Map<String, dynamic>.from(((met['metrics'] as Map)['persistence'] as Map)['1-24h'] as Map);
      children.add(Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 10),
        child: Text('Kiểm thử 1-24h: RMSE ${_fmt(m['rmse'], 2)} (bền vững ${_fmt(b['rmse'], 2)}) · R² ${_fmt(m['r2'], 3)}',
            style: const TextStyle(fontSize: 12, color: AppColors.text2)),
      ));
      final imp = ((met['importance'] as List?) ?? const []).take(5).map((e) => Map<String, dynamic>.from(e as Map));
      for (final f in imp) {
        final double share = (_num(f['share']) ?? 0.0) / 100;
        children.add(Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(_featureVi('${f['feature']}'), style: const TextStyle(fontSize: 12, color: AppColors.text2))),
              Text('${_fmt(f['share'])}%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF7C3AED))),
            ]),
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(9),
              child: LinearProgressIndicator(
                  value: share.clamp(0.0, 1.0), minHeight: 7, color: const Color(0xFF7C3AED), backgroundColor: const Color(0xFFF1F5F9)),
            ),
          ]),
        ));
      }
    } else {
      children.add(const Padding(
        padding: EdgeInsets.only(top: 4),
        child: Text('Chưa có kết quả huấn luyện cho chất này (scripts/airdata_train.py).',
            style: TextStyle(fontSize: 12, color: AppColors.muted)),
      ));
    }
    return SectionCard(
      title: 'Mô hình & giải thích (XAI)',
      subtitle: 'Đọc từ kết quả huấn luyện thật (metrics.json)',
      icon: Icons.psychology_outlined,
      iconColor: const Color(0xFF7C3AED),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
    );
  }

  String _featureVi(String f) {
    const m = {
      'lag_0': 'Nồng độ tại thời điểm phát hành', 'lag_1': 'Trễ 1 giờ', 'lag_24': 'Trễ 24 giờ', 'mean_24': 'TB trượt 24 giờ',
      'mean_72': 'TB trượt 72 giờ', 'mean_168': 'TB trượt 7 ngày', 'anom_0': 'Dị thường so với khí hậu', 'horizon': 'Hạn dự báo',
      'clim_T': 'Khí hậu tháng × giờ', 't_hour_sin': 'Giờ trong ngày', 't_hour_cos': 'Giờ trong ngày', 'w_wind_speed': 'Tốc độ gió',
      'w_wind_6h': 'Gió TB 6 giờ', 'w_rain_24h': 'Tổng mưa 24 giờ', 'w_relative_humidity': 'Độ ẩm', 'w_temperature_2m': 'Nhiệt độ',
      'w_precipitation': 'Lượng mưa', 't_month_sin': 'Tháng', 't_month_cos': 'Tháng', 't_tet': 'Dịp Tết', 't_dow': 'Thứ trong tuần',
    };
    if (f.startsWith('x_')) return 'Nồng độ ${_names[f.substring(2)] ?? f.substring(2)} hiện tại';
    return m[f] ?? f;
  }

  Widget _hourlyList() {
    final rows = _hourly.take(_range).toList();
    final shown = _range <= 24 ? rows : [for (var i = 0; i < rows.length; i += 3) rows[i]];
    final p = _pollutant;
    final limit = _limit(p);
    return SectionCard(
      title: 'Chi tiết theo giờ',
      subtitle: _range <= 24 ? 'Hôm nay, từng giờ' : 'Mỗi 3 giờ một mốc',
      icon: Icons.table_rows_outlined,
      iconColor: AppColors.teal,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        children: shown.map((r) {
          final v = _num(r[p]);
          final aqi = _aqiOf(r);
          final t = '${r['time']}';
          return Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFEEF2F7)))),
            child: Row(children: [
              SizedBox(
                width: 86,
                child: Text('${t.substring(11, 16)} ${t.substring(8, 10)}/${t.substring(5, 7)}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: AppColors.text)),
              ),
              Icon(r['observed'] == true ? Icons.check_circle_outline : Icons.auto_graph,
                  size: 15, color: r['observed'] == true ? AppColors.success : const Color(0xFF7C3AED)),
              const SizedBox(width: 6),
              Expanded(
                child: Text('${_fmt(v)} ${_unit(p)}',
                    style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 12.5,
                        color: (limit != null && v != null && v > limit) ? AppColors.danger : _colors[p])),
              ),
              if (aqi != null) ...[
                Text('$aqi', style: TextStyle(fontWeight: FontWeight.w900, color: AqiUtils.strong(aqi))),
                const SizedBox(width: 8),
                AqiPill(aqi: aqi, dense: true),
              ],
            ]),
          );
        }).toList(),
      ),
    );
  }
}
