import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/aqi_utils.dart';
import '../core/ward_catalog.dart';
import 'ui.dart';
import 'ward_picker.dart';

/// Khu vực theo dõi của thành viên: nơi sinh sống & nơi làm việc / học tập.
/// Hiện AQI hiện tại của từng nơi (cùng nguồn số liệu phường với bản đồ / WebGIS) và cho phép đổi khu vực.
class MyAreasSection extends StatefulWidget {
  /// PM2.5 hiện tại theo mã phường (từ /aqi/spatial-summary)
  final Map<String, double> wardPm;

  /// AQI NowCast hiện tại theo mã phường: (VN_AQI, US AQI) do máy chủ tính
  final Map<String, (int?, int?)> wardAqi;
  final bool useUS;
  final void Function(WardShape ward)? onShowOnMap;

  const MyAreasSection({super.key, required this.wardPm, this.wardAqi = const {}, required this.useUS, this.onShowOnMap});

  @override
  State<MyAreasSection> createState() => _MyAreasSectionState();
}

class _MyAreasSectionState extends State<MyAreasSection> {
  static const _kinds = <(String, String, IconData)>[
    ('home', 'Nơi sinh sống', Icons.home_outlined),
    ('work', 'Nơi làm việc / học tập', Icons.work_outline),
  ];

  bool _saving = false;
  String? _note;
  bool _noteIsWarning = false;

  @override
  void initState() {
    super.initState();
    WardCatalog.load(); // để chip AQI mở được phường trên bản đồ
  }

  Future<void> _pick(String key, String label, IconData icon) async {
    final pick = await WardPickerSheet.show(
      context,
      title: label,
      icon: icon,
      selectedCode: AppState.area(key)?['code']?.toString(),
    );
    if (pick == null || !mounted) return;

    final value = pick.ward == null ? null : <String, dynamic>{'code': pick.ward!.code, 'name': pick.ward!.displayName};
    setState(() {
      _saving = true;
      _note = null;
    });
    final note = await AppState.updateAreas(
      home: key == 'home' ? value : AppState.area('home'),
      work: key == 'work' ? value : AppState.area('work'),
    );
    if (!mounted) return;
    setState(() {
      _saving = false;
      _noteIsWarning = note != null;
      _note = note ??
          (value == null ? 'Đã bỏ chọn ${label.toLowerCase()}.' : 'Đã lưu ${label.toLowerCase()}: ${value['name']}.');
    });
  }

  Widget _aqiChip(int aqi, String code) {
    final ward = WardCatalog.byCode(code);
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: ward == null || widget.onShowOnMap == null ? null : () => widget.onShowOnMap!(ward),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: AqiUtils.chipBg(aqi), borderRadius: BorderRadius.circular(20)),
        child: Text(
          '${widget.useUS ? 'US' : 'VN'} $aqi',
          style: TextStyle(color: AqiUtils.chipFg(aqi), fontWeight: FontWeight.w800, fontSize: 12),
        ),
      ),
    );
  }

  Widget _tile(String key, String label, IconData icon) {
    final area = AppState.area(key);
    final code = area?['code']?.toString();
    final pm = code == null ? null : widget.wardPm[code];
    final srv = code == null ? null : widget.wardAqi[code];
    final aqi = pm == null ? null : AqiUtils.pick(srv?.$1, srv?.$2, pm, useUS: widget.useUS);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      onTap: _saving ? null : () => _pick(key, label, icon),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
        child: Icon(icon, color: AppColors.brand, size: 22),
      ),
      title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      subtitle: Text(
        area?['name']?.toString() ?? 'Chưa chọn · chạm để chọn phường/xã',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 13,
          color: area == null ? AppColors.muted : AppColors.text2,
          fontStyle: area == null ? FontStyle.italic : FontStyle.normal,
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (aqi != null && code != null) _aqiChip(aqi, code),
          const SizedBox(width: 4),
          Icon(area == null ? Icons.add_location_alt_outlined : Icons.edit_outlined, size: 20, color: AppColors.muted),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<Map<String, dynamic>?>(
      valueListenable: AppState.user,
      builder: (_, _, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('Khu vực theo dõi', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(width: 8),
              if (_saving) const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
            ],
          ),
          const Text(
            'Chọn nơi bạn sống và làm việc để theo dõi chất lượng không khí',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          for (final (key, label, icon) in _kinds) _tile(key, label, icon),
          if (_note != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                _note!,
                style: TextStyle(fontSize: 12.5, color: _noteIsWarning ? const Color(0xFFB45309) : AppColors.success),
              ),
            ),
        ],
      ),
    );
  }
}
