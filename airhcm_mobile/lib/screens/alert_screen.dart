import 'package:flutter/material.dart';

import '../core/alarm_service.dart';
import '../core/api_service.dart';
import '../core/app_state.dart';
import '../core/aqi_utils.dart';
import '../core/notification_service.dart';
import '../core/ward_catalog.dart';
import '../widgets/ui.dart';

/// Cảnh báo sức khỏe: trạng thái DSS Engine (Activity Diagram), nhật ký kích hoạt,
/// điểm nóng ô nhiễm thời gian thực và đăng ký nhận cảnh báo (Push FCM + Email).
class AlertSubscriptionScreen extends StatefulWidget {
  const AlertSubscriptionScreen({super.key});

  @override
  State<AlertSubscriptionScreen> createState() => _AlertSubscriptionScreenState();
}

class _AlertSubscriptionScreenState extends State<AlertSubscriptionScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();

  static const _allWards = 'Tất cả TP.HCM';
  String _selectedWard = _allWards;
  int _threshold = 100;
  bool _submitting = false;
  List<String> _wardNames = const [_allWards];

  List<dynamic> _history = [];
  List<dynamic> _hotspots = [];
  bool _loadingLists = true;

  bool _testing = false;

  @override
  void initState() {
    super.initState();
    _threshold = AlarmService.threshold.value;
    _prefillFromUser();
    AppState.user.addListener(_prefillFromUser);
    AppState.alert.addListener(_refresh);
    AppState.useUSAQI.addListener(_refresh);
    WardCatalog.load().then((wards) {
      if (mounted) setState(() => _wardNames = [_allWards, ...wards.map((w) => w.displayName)]);
    });
    _loadLists();
  }

  @override
  void dispose() {
    AppState.user.removeListener(_prefillFromUser);
    AppState.alert.removeListener(_refresh);
    AppState.useUSAQI.removeListener(_refresh);
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  void _prefillFromUser() {
    final u = AppState.user.value;
    if (u == null) return;
    if (_nameController.text.isEmpty) _nameController.text = '${u['fullname'] ?? ''}';
    if (_emailController.text.isEmpty) _emailController.text = '${u['email'] ?? ''}';
  }

  Future<void> _loadLists() async {
    setState(() => _loadingLists = true);
    try {
      final results = await Future.wait([ApiService.alertHistory(limit: 8), ApiService.spatialSummary()]);
      _history = results[0];
      _hotspots = results[1].take(5).toList();
    } catch (e) {
      debugPrint('Không nạp được dữ liệu cảnh báo: $e');
    }
    await AppState.refreshShared();
    if (mounted) setState(() => _loadingLists = false);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      final token = await NotificationService.getToken();
      await ApiService.subscribe(
        fullname: _nameController.text.trim(),
        email: _emailController.text.trim(),
        phone: _phoneController.text.trim(),
        wardCode: _selectedWard,
        thresholdAqi: _threshold,
        fcmToken: token,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.success,
        content: Text(token != null
            ? '✅ Đã đăng ký! Thiết bị sẽ nhận Push khi AI dự báo AQI vượt $_threshold.'
            : '✅ Đã đăng ký! Cán bộ có thể gửi cảnh báo tới email của bạn (thiết bị chưa bật Push).'),
      ));
      _phoneController.clear();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e'), backgroundColor: const Color(0xFFEA580C), behavior: SnackBarBehavior.floating),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  InputDecoration _input(String label, IconData icon) => InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        filled: true,
        fillColor: AppColors.surface2,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.line)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.line)),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cảnh báo sức khỏe', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        actions: [IconButton(tooltip: 'Làm mới', onPressed: _loadLists, icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: _loadLists,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
          children: [
            if (AppState.alert.value != null) ...[
              AlertStatusCard(alert: AppState.alert.value),
              const SizedBox(height: 14),
            ],
            _soundCard(),
            const SizedBox(height: 14),
            _historyCard(),
            const SizedBox(height: 14),
            _hotspotCard(),
            const SizedBox(height: 14),
            _subscribeCard(),
          ],
        ),
      ),
    );
  }

  Future<void> _testSound() async {
    setState(() => _testing = true);
    final ok = await AlarmService.test();
    if (!mounted) return;
    setState(() => _testing = false);
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        behavior: SnackBarBehavior.floating,
        content: Text('Chưa phát được thông báo. Hãy cho phép AirHCM gửi thông báo trong Cài đặt của điện thoại.'),
      ));
    }
  }

  /// Cài đặt tiếng còi khi AQI vượt ngưỡng (lưu trong máy)
  Widget _soundCard() {
    return ListenableBuilder(
      listenable: Listenable.merge([AlarmService.enabled, AlarmService.lastRung]),
      builder: (context, _) {
        final enabled = AlarmService.enabled.value;
        final last = AlarmService.lastRung.value;
        final lastText = last == null
            ? 'Chưa phát lần nào'
            : 'Lần gần nhất: ${last.hour.toString().padLeft(2, '0')}:${last.minute.toString().padLeft(2, '0')} '
                '${last.day.toString().padLeft(2, '0')}/${last.month.toString().padLeft(2, '0')}';
        return SectionCard(
          title: 'Âm thanh cảnh báo',
          subtitle: 'Phát tiếng còi khi AI dự báo AQI vượt ngưỡng',
          icon: enabled ? Icons.notifications_active : Icons.notifications_off_outlined,
          iconColor: enabled ? AppColors.danger : AppColors.muted,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Bật tiếng còi cảnh báo', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                subtitle: Text(
                  'Kêu khi AQI dự báo ≥ $_threshold (US AQI) · tối đa 1 lần/${AlarmService.cooldown.inHours} giờ',
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                value: enabled,
                onChanged: (v) => AlarmService.setEnabled(v),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(
                    child: Text(lastText, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                  ),
                  OutlinedButton.icon(
                    onPressed: _testing ? null : _testSound,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      side: const BorderSide(color: Color(0xFFFCA5A5)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    icon: _testing
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.volume_up_rounded, size: 18),
                    label: const Text('Nghe thử', style: TextStyle(fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _historyCard() {
    return SectionCard(
      title: 'Nhật ký cảnh báo tự động',
      subtitle: 'Dự báo AI → Đối chiếu QCVN 05:2023 → Kích hoạt cảnh báo',
      icon: Icons.history,
      iconColor: const Color(0xFF1E3A8A),
      child: _loadingLists
          ? const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator()))
          : _history.isEmpty
              ? const Text('Chưa có lần kích hoạt nào.', style: TextStyle(color: AppColors.muted, fontSize: 13))
              : Column(
                  children: _history.map((h) {
                    final warning = h['status'] == 'WARNING';
                    final color = warning ? AppColors.danger : AppColors.success;
                    final time = '${h['time'] ?? ''}';
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            margin: const EdgeInsets.only(top: 4),
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(color: color, shape: BoxShape.circle, boxShadow: [BoxShadow(color: color.withValues(alpha: 0.3), spreadRadius: 3)]),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  warning ? 'Warning_NhayCam · đỉnh ${h['peak_pm25']} µg/m³' : 'Bình thường · đỉnh ${h['peak_pm25']} µg/m³',
                                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: warning ? const Color(0xFF991B1B) : const Color(0xFF166534)),
                                ),
                                Text(
                                  '${time.length >= 16 ? time.substring(0, 16) : time}'
                                  '${warning ? ' · ${h['exceed_hours']} giờ vượt QCVN' : ''}'
                                  '${(h['push_sent'] ?? 0) > 0 ? ' · Push ${h['push_sent']} thiết bị' : ''}',
                                  style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
    );
  }

  Widget _hotspotCard() {
    final useUS = AppState.useUSAQI.value;
    return SectionCard(
      title: 'Top điểm nóng ô nhiễm',
      subtitle: 'Cập nhật thời gian thực từ 166 phường/xã',
      icon: Icons.local_fire_department_outlined,
      iconColor: const Color(0xFFEA580C),
      child: _loadingLists
          ? const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator()))
          : _hotspots.isEmpty
              ? const Text('Chưa có dữ liệu điểm nóng.', style: TextStyle(color: AppColors.muted, fontSize: 13))
              : Column(
                  children: [
                    for (var i = 0; i < _hotspots.length; i++) _hotspotRow(i, _hotspots[i], useUS),
                  ],
                ),
    );
  }

  Widget _hotspotRow(int i, dynamic w, bool useUS) {
    final pm = AqiUtils.toDouble(w['pm2_5_trung_binh']);
    final aqi = AqiUtils.compute(pm, useUS: useUS);
    const medals = [Color(0xFFF59E0B), Color(0xFF94A3B8), Color(0xFFEA580C)];
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: AppColors.surface2, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(color: i < 3 ? medals[i] : const Color(0xFFE2E8F0), borderRadius: BorderRadius.circular(9)),
            child: Center(child: Text('${i + 1}', style: TextStyle(fontWeight: FontWeight.w900, color: i < 3 ? Colors.white : AppColors.muted))),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text('${w['ten_phuong_xa']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
          Text('${pm.toStringAsFixed(1)} µg/m³', style: const TextStyle(color: AppColors.brand, fontWeight: FontWeight.w800, fontSize: 12.5)),
          const SizedBox(width: 10),
          AqiPill(aqi: aqi, text: '$aqi', dense: true),
        ],
      ),
    );
  }

  Widget _subscribeCard() {
    return SectionCard(
      title: 'Đăng ký nhận cảnh báo sớm',
      subtitle: 'Nhận Push khi AI dự báo AQI vượt ngưỡng bạn chọn',
      icon: Icons.notifications_active_outlined,
      iconColor: const Color(0xFF7C3AED),
      child: Form(
        key: _formKey,
        child: Column(
          children: [
            TextFormField(
              controller: _nameController,
              decoration: _input('Họ và tên', Icons.person_outline),
              validator: (v) => (v ?? '').trim().isEmpty ? 'Vui lòng nhập họ tên' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: _input('Email nhận thông báo', Icons.email_outlined),
              validator: (v) => !(v ?? '').contains('@') ? 'Email không hợp lệ' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              decoration: _input('Số điện thoại (Zalo)', Icons.phone_outlined),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _selectedWard,
              isExpanded: true,
              menuMaxHeight: 420,
              decoration: _input('Khu vực theo dõi', Icons.location_city_outlined),
              items: _wardNames
                  .map((w) => DropdownMenuItem(value: w, child: Text(w, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5))))
                  .toList(),
              onChanged: (v) => setState(() => _selectedWard = v ?? _allWards),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              initialValue: _threshold,
              decoration: _input('Ngưỡng kích hoạt cảnh báo', Icons.tune),
              items: const [
                DropdownMenuItem(value: 100, child: Text('AQI > 100 · Bắt đầu ảnh hưởng nhóm nhạy cảm')),
                DropdownMenuItem(value: 150, child: Text('AQI > 150 · Mức xấu')),
                DropdownMenuItem(value: 200, child: Text('AQI > 200 · Rất xấu')),
              ],
              onChanged: (v) {
                setState(() => _threshold = v ?? 100);
                AlarmService.setThreshold(_threshold); // Còi trong máy dùng chung ngưỡng với Push
              },
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                onPressed: _submitting ? null : _submit,
                icon: _submitting
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                    : const Icon(Icons.send_rounded),
                label: const Text('Đăng ký nhận cảnh báo', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(NotificationService.isReady ? Icons.check_circle : Icons.info_outline, size: 14,
                    color: NotificationService.isReady ? AppColors.success : AppColors.muted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    NotificationService.isReady
                        ? 'Thiết bị đã sẵn sàng nhận Push Notification'
                        : 'Push chưa sẵn sàng - cán bộ vẫn có thể gửi cảnh báo qua Email',
                    style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
