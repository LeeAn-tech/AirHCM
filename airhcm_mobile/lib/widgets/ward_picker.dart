import 'package:flutter/material.dart';

import '../core/location_service.dart';
import '../core/ward_catalog.dart';
import 'ui.dart';

/// Kết quả chọn phường/xã; [ward] == null nghĩa là người dùng bỏ chọn
class WardPick {
  final WardShape? ward;
  const WardPick(this.ward);
}

/// Bảng chọn 1 trong 168 phường/xã TP.HCM: tìm không dấu, chọn theo vị trí GPS hiện tại hoặc bỏ chọn
class WardPickerSheet extends StatefulWidget {
  final String title;
  final IconData icon;
  final String? selectedCode;

  const WardPickerSheet({super.key, required this.title, required this.icon, this.selectedCode});

  static Future<WardPick?> show(BuildContext context,
          {required String title, required IconData icon, String? selectedCode}) =>
      showModalBottomSheet<WardPick>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
        builder: (_) => WardPickerSheet(title: title, icon: icon, selectedCode: selectedCode),
      );

  @override
  State<WardPickerSheet> createState() => _WardPickerSheetState();
}

class _WardPickerSheetState extends State<WardPickerSheet> {
  List<WardShape> _wards = const [];
  String _query = '';
  bool _locating = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WardCatalog.load().then((w) {
      if (mounted) setState(() => _wards = w);
    });
  }

  List<WardShape> get _filtered {
    final q = WardCatalog.fold(_query.trim());
    if (q.isEmpty) return _wards;
    return _wards.where((w) => WardCatalog.fold(w.displayName).contains(q)).toList();
  }

  Future<void> _useCurrentLocation() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      final pos = await LocationService.currentPosition();
      await WardCatalog.load();
      final ward = WardCatalog.locate(pos);
      if (!mounted) return;
      if (ward == null) {
        setState(() => _error = 'Vị trí hiện tại không nằm trong phường/xã nào của TP.HCM.');
      } else {
        Navigator.pop(context, WardPick(ward));
      }
    } on LocationException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Không lấy được vị trí hiện tại. Vui lòng thử lại.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _filtered;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.82,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 8, 4),
              child: Row(
                children: [
                  Icon(widget.icon, color: AppColors.brand),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  ),
                  IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                onChanged: (v) => setState(() => _query = v),
                decoration: InputDecoration(
                  hintText: 'Tìm phường/xã (gõ không dấu cũng được)',
                  prefixIcon: const Icon(Icons.search),
                  filled: true,
                  fillColor: AppColors.surface2,
                  isDense: true,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  ActionChip(
                    avatar: _locating
                        ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.my_location, size: 16, color: AppColors.brand),
                    label: const Text('Dùng vị trí hiện tại'),
                    onPressed: _locating ? null : _useCurrentLocation,
                  ),
                  if (widget.selectedCode != null)
                    ActionChip(
                      avatar: const Icon(Icons.close, size: 16, color: AppColors.danger),
                      label: const Text('Bỏ chọn'),
                      onPressed: () => Navigator.pop(context, const WardPick(null)),
                    ),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
                child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
              ),
            const Divider(height: 16),
            Expanded(
              child: _wards.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : items.isEmpty
                      ? const Center(
                          child: Text('Không tìm thấy phường/xã phù hợp', style: TextStyle(color: AppColors.muted)),
                        )
                      : ListView.builder(
                          itemCount: items.length,
                          itemBuilder: (_, i) {
                            final w = items[i];
                            final selected = w.code == widget.selectedCode;
                            return ListTile(
                              dense: true,
                              leading: Icon(
                                selected ? Icons.check_circle : Icons.place_outlined,
                                color: selected ? AppColors.brand : AppColors.muted,
                              ),
                              title: Text(
                                w.displayName,
                                style: TextStyle(fontWeight: selected ? FontWeight.w800 : FontWeight.w500, fontSize: 14),
                              ),
                              onTap: () => Navigator.pop(context, WardPick(w)),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }
}
