import 'package:flutter/material.dart';

import '../core/api_config.dart';
import '../core/aqi_utils.dart';

/// Bảng màu thương hiệu AirHCM (đồng bộ WebGIS)
class AppColors {
  AppColors._();
  static const navy = Color(0xFF0B1B4D);
  static const brand = Color(0xFF0284C7);
  static const cyan = Color(0xFF06B6D4);
  static const teal = Color(0xFF14B8A6);
  static const text = Color(0xFF0F172A);
  static const text2 = Color(0xFF334155);
  static const muted = Color(0xFF64748B);
  static const line = Color(0xFFE2E8F0);
  static const surface2 = Color(0xFFF8FAFC);
  static const bg = Color(0xFFF2F6FB);
  static const danger = Color(0xFFDC2626);
  static const success = Color(0xFF16A34A);

  static const brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF1E40AF), Color(0xFF0284C7), Color(0xFF06B6D4)],
  );
}

/// Thẻ nội dung có tiêu đề + biểu tượng
class SectionCard extends StatelessWidget {
  final String? title;
  final String? subtitle;
  final IconData? icon;
  final Color iconColor;
  final Widget? trailing;
  final Widget child;
  final EdgeInsetsGeometry padding;

  const SectionCard({
    super.key,
    this.title,
    this.subtitle,
    this.icon,
    this.iconColor = AppColors.brand,
    this.trailing,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.line),
        boxShadow: const [BoxShadow(color: Color(0x0F0F172A), blurRadius: 12, offset: Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Row(
              children: [
                if (icon != null) ...[
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: iconColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(icon, color: iconColor, size: 18),
                  ),
                  const SizedBox(width: 10),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title!, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.text)),
                      if (subtitle != null)
                        Text(subtitle!, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
            const SizedBox(height: 14),
          ],
          child,
        ],
      ),
    );
  }
}

/// Nhãn cấp độ AQI (giống aqi-pill trên WebGIS)
class AqiPill extends StatelessWidget {
  final int aqi;
  final String? text;
  final bool dense;
  const AqiPill({super.key, required this.aqi, this.text, this.dense = false});

  @override
  Widget build(BuildContext context) {
    final fg = AqiUtils.chipFg(aqi);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 8 : 10, vertical: dense ? 3 : 4),
      decoration: BoxDecoration(
        color: AqiUtils.chipBg(aqi),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: fg.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 6, height: 6, decoration: BoxDecoration(color: fg, shape: BoxShape.circle)),
          const SizedBox(width: 5),
          Text(text ?? AqiUtils.shortLevel(aqi),
              style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: dense ? 10.5 : 11.5)),
        ],
      ),
    );
  }
}

/// Thẻ trạng thái cảnh báo DSS (Activity Diagram): WARNING (Warning_NhayCam) hoặc NORMAL
class AlertStatusCard extends StatelessWidget {
  final Map<String, dynamic>? alert;
  final bool compact;
  final VoidCallback? onTap;
  const AlertStatusCard({super.key, required this.alert, this.compact = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    final a = alert;
    if (a == null || a['status'] == null || a['status'] == 'UNKNOWN') return const SizedBox.shrink();
    final isWarning = a['status'] == 'WARNING';
    final accent = isWarning ? AppColors.danger : AppColors.success;
    final best = (a['best_window'] as Map?)?['label'];
    final worst = (a['worst_window'] as Map?)?['label'];

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.all(compact ? 10 : 16),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: isWarning
                ? [const Color(0xFFFFF1F2), Colors.white]
                : [const Color(0xFFF0FDF4), Colors.white],
          ),
          borderRadius: BorderRadius.circular(compact ? 14 : 18),
          border: Border.all(color: accent.withValues(alpha: 0.3)),
          boxShadow: const [BoxShadow(color: Color(0x140F172A), blurRadius: 12, offset: Offset(0, 4))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: compact ? 32 : 42,
                  height: compact ? 32 : 42,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: isWarning
                          ? [const Color(0xFFF43F5E), const Color(0xFFF97316)]
                          : [const Color(0xFF10B981), const Color(0xFF22C55E)],
                    ),
                    borderRadius: BorderRadius.circular(compact ? 10 : 13),
                  ),
                  child: Icon(isWarning ? Icons.warning_amber_rounded : Icons.health_and_safety,
                      color: Colors.white, size: compact ? 18 : 22),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isWarning ? 'Cảnh báo: PM2.5 dự báo vượt QCVN 05:2023' : 'Không khí 24h tới trong ngưỡng an toàn',
                        maxLines: compact ? 1 : 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: compact ? 12.5 : 14.5,
                          color: isWarning ? const Color(0xFF991B1B) : const Color(0xFF166534),
                        ),
                      ),
                      Text(
                        'Đỉnh ${a['peak_pm25']} µg/m³ lúc ${a['peak_label'] ?? '--'}'
                        '${isWarning ? ' · ${a['exceed_hours']} giờ vượt 50 µg/m³' : ''}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11.5, color: AppColors.text2, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
                if (compact) Icon(Icons.chevron_right, color: accent),
              ],
            ),
            if (!compact) ...[
              const SizedBox(height: 10),
              Text('${a['message'] ?? ''}', style: const TextStyle(fontSize: 12.5, height: 1.5, color: AppColors.text2)),
              if (best != null && worst != null) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: _window(Icons.wb_sunny_outlined, 'Nên ra ngoài', '$best', AppColors.success)),
                    const SizedBox(width: 8),
                    Expanded(child: _window(Icons.masks_outlined, 'Nên tránh', '$worst', AppColors.danger)),
                  ],
                ),
              ],
            ],
          ],
        ),
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

/// Khung báo lỗi kết nối + nút thử lại / cài đặt máy chủ
class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const ErrorView({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFDBA74)),
      ),
      child: Column(
        children: [
          const Icon(Icons.cloud_off_rounded, color: Color(0xFFEA580C), size: 34),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: AppColors.text2)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            alignment: WrapAlignment.center,
            children: [
              FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh, size: 18), label: const Text('Thử lại')),
              OutlinedButton.icon(
                onPressed: () async {
                  final changed = await ServerSettingsSheet.show(context);
                  if (changed) onRetry();
                },
                icon: const Icon(Icons.dns_outlined, size: 18),
                label: const Text('Máy chủ'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Cài đặt địa chỉ máy chủ Backend (thay cho IP gắn cứng trong mã nguồn)
class ServerSettingsSheet {
  ServerSettingsSheet._();

  static Future<bool> show(BuildContext context) async {
    final ctrl = TextEditingController(text: ApiConfig.server);
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => _ServerSettingsBody(controller: ctrl),
    );
    return result ?? false;
  }
}

class _ServerSettingsBody extends StatefulWidget {
  final TextEditingController controller;
  const _ServerSettingsBody({required this.controller});

  @override
  State<_ServerSettingsBody> createState() => _ServerSettingsBodyState();
}

class _ServerSettingsBodyState extends State<_ServerSettingsBody> {
  bool _testing = false;
  bool _scanning = false;
  String? _result;
  bool _ok = false;

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _result = null;
    });
    final server = ApiConfig.normalize(widget.controller.text);
    _ok = await ApiConfig.ping(server, timeout: const Duration(seconds: 5));
    _result = _ok
        ? 'Kết nối thành công tới máy chủ AirHCM ($server)'
        : 'Không kết nối được $server. Thử "Tự tìm máy chủ" hoặc kiểm tra Backend đã chạy & cùng mạng Wi-Fi.';
    if (mounted) setState(() => _testing = false);
  }

  /// Quét mạng Wi-Fi tìm máy tính đang chạy Backend AirHCM (khi IP máy tính bị đổi)
  Future<void> _scan() async {
    setState(() {
      _scanning = true;
      _ok = false;
      _result = 'Đang tìm máy chủ AirHCM trong mạng Wi-Fi...';
    });
    final found = await ApiConfig.discover(onProgress: (done, total) {
      if (mounted && done % 16 == 0) setState(() => _result = 'Đang tìm máy chủ AirHCM trong mạng Wi-Fi... ($done/$total)');
    });
    if (!mounted) return;
    setState(() {
      _scanning = false;
      _ok = found != null;
      if (found != null) {
        widget.controller.text = found;
        _result = 'Đã tìm thấy & lưu máy chủ: $found';
      } else {
        _result = 'Không tìm thấy máy chủ trong mạng này. Hãy bật Backend (python run.py) và kết nối cùng Wi-Fi với máy tính.';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Cài đặt máy chủ AirHCM', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          const SizedBox(height: 4),
          const Text(
            'Ứng dụng tự tìm máy tính đang chạy Backend trong cùng mạng Wi-Fi khi IP thay đổi. '
            'Có thể nhập tay (xem IP bằng lệnh ipconfig) · Máy ảo Android: http://10.0.2.2:8000',
            style: TextStyle(fontSize: 12.5, color: AppColors.muted, height: 1.4),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: widget.controller,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'Địa chỉ máy chủ',
              hintText: ApiConfig.defaultServer,
              prefixIcon: Icon(Icons.dns_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: FilledButton.tonalIcon(
              onPressed: _scanning || _testing ? null : _scan,
              icon: _scanning
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.travel_explore, size: 18),
              label: const Text('Tự tìm máy chủ trong mạng Wi-Fi'),
            ),
          ),
          if (_result != null) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(_ok ? Icons.check_circle : Icons.error_outline, color: _ok ? AppColors.success : AppColors.danger, size: 18),
                const SizedBox(width: 6),
                Expanded(child: Text(_result!, style: TextStyle(fontSize: 12.5, color: _ok ? AppColors.success : AppColors.danger))),
              ],
            ),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _testing || _scanning ? null : _test,
                  icon: _testing
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.network_check, size: 18),
                  label: const Text('Kiểm tra'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: () async {
                    final navigator = Navigator.of(context);
                    await ApiConfig.save(widget.controller.text);
                    navigator.pop(true);
                  },
                  icon: const Icon(Icons.save_outlined, size: 18),
                  label: const Text('Lưu'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
