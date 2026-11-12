import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../core/api_service.dart';
import '../core/app_state.dart';
import '../core/aqi_utils.dart';
import 'ui.dart';

/// Bảng phân tích chất lượng không khí tại một tọa độ (Sequence Diagram):
/// App gửi tọa độ -> Backend -> AI Engine (dự báo) + PostGIS (Spatial Query) -> JSON -> hiển thị
class LocationInsightSheet {
  LocationInsightSheet._();

  static Future<void> show(BuildContext context, LatLng point, {String title = 'Phân tích vị trí'}) {
    AppState.lastLocation.value = point;
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.62,
        minChildSize: 0.35,
        maxChildSize: 0.92,
        builder: (ctx, scroll) => _InsightBody(point: point, title: title, scrollController: scroll),
      ),
    );
  }
}

class _InsightBody extends StatefulWidget {
  final LatLng point;
  final String title;
  final ScrollController scrollController;
  const _InsightBody({required this.point, required this.title, required this.scrollController});

  @override
  State<_InsightBody> createState() => _InsightBodyState();
}

class _InsightBodyState extends State<_InsightBody> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _data = null;
      _error = null;
    });
    try {
      final data = await ApiService.locationInsight(widget.point.latitude, widget.point.longitude);
      final ward = data['ward'] as Map?;
      AppState.lastWardName = ward?['ten_phuong_xa']?.toString();
      if (mounted) setState(() => _data = data);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      controller: widget.scrollController,
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 24),
      children: [
        Center(
          child: Container(
            width: 42,
            height: 5,
            decoration: BoxDecoration(color: AppColors.line, borderRadius: BorderRadius.circular(9)),
          ),
        ),
        const SizedBox(height: 14),
        if (_error != null)
          ErrorView(message: _error!, onRetry: _load)
        else if (_data == null)
          _loading()
        else
          ..._content(_data!),
      ],
    );
  }

  Widget _loading() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 30),
      child: Column(
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 14),
          Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 4),
          Text(
            '${widget.point.latitude.toStringAsFixed(4)}N, ${widget.point.longitude.toStringAsFixed(4)}E\n'
            'Đang truy vấn PostGIS & AI Engine...',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
        ],
      ),
    );
  }

  List<Widget> _content(Map<String, dynamic> d) {
    final useUS = AppState.useUSAQI.value;
    final ward = d['ward'] as Map?;
    final station = d['nearest_station'] as Map?;
    final current = Map<String, dynamic>.from(d['current'] ?? {});
    final fs = Map<String, dynamic>.from(d['forecast_summary'] ?? {});
    final advisory = Map<String, dynamic>.from(d['advisory'] ?? {});
    final alert = d['alert'] as Map<String, dynamic>?;

    final pm = AqiUtils.toDouble(current['pm2_5']);
    final aqi = AqiUtils.compute(pm, useUS: useUS);
    final peak = fs['peak'] as Map?;
    final best = fs['best_window'] as Map?;
    final worst = fs['worst_window'] as Map?;

    final wardTitle = ward == null
        ? 'Ngoài phạm vi TP.HCM'
        : '${ward['loai_don_vi'] ?? ''} ${ward['ten_phuong_xa']}'.trim();
    final wardSub = ward == null
        ? 'Không thuộc ranh giới 166 phường/xã'
        : (ward['inside'] == true
            ? 'Vị trí thuộc ranh giới phường/xã này'
            : 'Phường/xã gần nhất (cách ${((ward['distance_m'] ?? 0) / 1000).toStringAsFixed(1)} km)');

    return [
      Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(gradient: AppColors.brandGradient, borderRadius: BorderRadius.circular(14)),
            child: const Icon(Icons.my_location, color: Colors.white),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(wardTitle, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: AppColors.text)),
                Text(wardSub, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      Row(
        children: [
          _ring(aqi, useUS),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AqiPill(aqi: aqi, text: AqiUtils.level(aqi)),
                const SizedBox(height: 6),
                Text('PM2.5 hiện tại: ${pm.toStringAsFixed(1)} µg/m³',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.brand)),
                if (station != null)
                  Text(
                    'Trạm gần nhất: ${station['ten_tram']} (${((station['distance_m'] ?? 0) / 1000).toStringAsFixed(1)} km)',
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      if (peak != null)
        _row(Icons.trending_up, 'Đỉnh dự báo 24h', '${peak['pm2_5']} µg/m³ · ${peak['label']}',
            AqiUtils.toDouble(peak['pm2_5']) > 50 ? AppColors.danger : AppColors.brand),
      if (fs['exceed_hours'] != null)
        _row(Icons.timer_outlined, 'Số giờ vượt QCVN (50 µg/m³)', '${fs['exceed_hours']} giờ',
            (fs['exceed_hours'] ?? 0) > 0 ? AppColors.danger : AppColors.success),
      if (best != null && worst != null) ...[
        const SizedBox(height: 4),
        Row(
          children: [
            Expanded(child: _window(Icons.wb_sunny_outlined, 'Nên ra ngoài', '${best['label']}', AppColors.success)),
            const SizedBox(width: 8),
            Expanded(child: _window(Icons.masks_outlined, 'Nên tránh', '${worst['label']}', AppColors.danger)),
          ],
        ),
      ],
      const SizedBox(height: 12),
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface2,
          borderRadius: BorderRadius.circular(14),
          border: Border(left: BorderSide(color: AqiUtils.strong(aqi), width: 4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Khuyến cáo sức khỏe (DSS)', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
            const SizedBox(height: 4),
            Text('${advisory['general_population'] ?? ''}', style: const TextStyle(fontSize: 12.5, height: 1.45)),
            const SizedBox(height: 4),
            Text('Nhóm nhạy cảm: ${advisory['sensitive_groups'] ?? ''}',
                style: const TextStyle(fontSize: 12.5, height: 1.45, color: AppColors.text2)),
          ],
        ),
      ),
      if (alert != null && alert['status'] == 'WARNING') ...[
        const SizedBox(height: 10),
        AlertStatusCard(alert: alert, compact: true, onTap: () {
          Navigator.pop(context);
          AppState.tabIndex.value = 3;
        }),
      ],
      const SizedBox(height: 16),
      FilledButton.icon(
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
        onPressed: () {
          Navigator.pop(context);
          AppState.askAssistant('Tôi đang ở $wardTitle. Hôm nay tôi nên ra ngoài vào khung giờ nào và cần lưu ý gì về sức khỏe?');
        },
        icon: const Icon(Icons.smart_toy_outlined),
        label: const Text('Hỏi Trợ lý AI về vị trí này'),
      ),
    ];
  }

  Widget _ring(int aqi, bool useUS) {
    final color = AqiUtils.color(aqi);
    return Container(
      width: 76,
      height: 76,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.white,
        border: Border.all(color: AqiUtils.levelIndex(aqi) == 2 ? const Color(0xFFEAB308) : color, width: 5),
        boxShadow: [BoxShadow(color: color.withValues(alpha: 0.35), blurRadius: 14)],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('$aqi', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.text)),
          Text(AqiUtils.standardLabel(useUS), style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: AppColors.muted)),
        ],
      ),
    );
  }

  Widget _row(IconData icon, String label, String value, Color color) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: AppColors.surface2, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.text2))),
          Text(value, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: color)),
        ],
      ),
    );
  }

  Widget _window(IconData icon, String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 4),
            Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
          ]),
          const SizedBox(height: 3),
          Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.text)),
        ],
      ),
    );
  }
}
