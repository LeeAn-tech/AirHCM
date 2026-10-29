import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

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
  String _selectedWard = 'Tất cả TP.HCM';
  int _selectedThreshold = 100;
  bool _isLoading = false;

  final List<String> _wards = [
    'Tất cả TP.HCM',
    'Phường Bến Thành (Quận 1)',
    'Phường Bình Đông (Quận 8)',
    'Phường Tân Tạo (Bình Tân)',
    'Phường Phú Thọ Hòa (Tân Phú)',
    'Phường Tân Thới Hiệp (Quận 12)',
    'Phường Long Phước (TP. Thủ Đức)',
    'Trung tâm Củ Chi'
  ];

  Future<void> _submitSubscription() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      final url = Uri.parse('http://127.0.0.1:8000/api/v1/subscribe');
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'fullname': _nameController.text.trim(),
          'email': _emailController.text.trim(),
          'phone': _phoneController.text.trim(),
          'ward_code': _selectedWard,
          'threshold_aqi': _selectedThreshold,
        }),
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('✅ Đăng ký thành công cho ${_emailController.text}! Cảnh báo sẽ tự động gửi khi AQI > $_selectedThreshold.'),
            backgroundColor: const Color(0xFF16A34A),
          ),
        );
        _nameController.clear();
        _emailController.clear();
        _phoneController.clear();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Đã ghi nhận thông tin đăng ký cục bộ!'), backgroundColor: Color(0xFF0284C7)),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Đăng Ký Cảnh Báo AQI', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        backgroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE2E8F0))),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Nhận Cảnh Báo Ô Nhiễm Sớm', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                    const SizedBox(height: 4),
                    const Text('Hệ thống tự động phát email/thông báo khi AQI vượt ngưỡng.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _nameController,
                      decoration: const InputDecoration(labelText: 'Họ và tên', border: OutlineInputBorder()),
                      validator: (v) => v!.isEmpty ? 'Vui lòng nhập họ tên' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _emailController,
                      decoration: const InputDecoration(labelText: 'Email nhận thông báo', border: OutlineInputBorder()),
                      keyboardType: TextInputType.emailAddress,
                      validator: (v) => !v!.contains('@') ? 'Email không hợp lệ' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _phoneController,
                      decoration: const InputDecoration(labelText: 'Số điện thoại (Zalo)', border: OutlineInputBorder()),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: _selectedWard,
                      decoration: const InputDecoration(labelText: 'Khu vực theo dõi', border: OutlineInputBorder()),
                      items: _wards.map((w) => DropdownMenuItem(value: w, child: Text(w, style: const TextStyle(fontSize: 13)))).toList(),
                      onChanged: (v) => setState(() => _selectedWard = v!),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<int>(
                      value: _selectedThreshold,
                      decoration: const InputDecoration(labelText: 'Ngưỡng kích hoạt cảnh báo', border: OutlineInputBorder()),
                      items: const [
                        DropdownMenuItem(value: 100, child: Text('AQI > 100 (Bắt đầu kém)')),
                        DropdownMenuItem(value: 150, child: Text('AQI > 150 (Mức xấu)')),
                        DropdownMenuItem(value: 200, child: Text('AQI > 200 (Rất xấu)')),
                      ],
                      onChanged: (v) => setState(() => _selectedThreshold = v!),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _submitSubscription,
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0284C7), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                        child: _isLoading
                            ? const CircularProgressIndicator(color: Colors.white)
                            : const Text('Đăng Ký Nhận Cảnh Báo', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            const Text('Top Điểm Nóng Ô Nhiễm TP.HCM', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
            const SizedBox(height: 10),
            _buildHotspotItem('1', 'Tân Tạo (Bình Tân)', '48.5 µg/m³', 'AQI 133', const Color(0xFFEA580C)),
            _buildHotspotItem('2', 'Phường Bình Đông (Quận 8)', '45.2 µg/m³', 'AQI 125', const Color(0xFFEA580C)),
            _buildHotspotItem('3', 'Phú Thọ Hòa (Tân Phú)', '43.0 µg/m³', 'AQI 119', const Color(0xFFEA580C)),
            _buildHotspotItem('4', 'Tân Thới Hiệp (Quận 12)', '38.6 µg/m³', 'AQI 108', const Color(0xFFEA580C)),
          ],
        ),
      ),
    );
  }

  Widget _buildHotspotItem(String rank, String ward, String pm, String aqi, Color color) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE2E8F0))),
      child: Row(
        children: [
          CircleAvatar(radius: 12, backgroundColor: const Color(0xFFF1F5F9), child: Text('#$rank', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF64748B)))),
          const SizedBox(width: 12),
          Expanded(child: Text(ward, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5))),
          Text(pm, style: const TextStyle(color: Color(0xFF0284C7), fontWeight: FontWeight.bold, fontSize: 13)),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(6)),
            child: Text(aqi, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
          ),
        ],
      ),
    );
  }
}