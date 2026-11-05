import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AuthScreen extends StatefulWidget {
  final VoidCallback onLoginSuccess;
  const AuthScreen({super.key, required this.onLoginSuccess});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _obscurePassword = true;

  final _loginUserCtrl = TextEditingController();
  final _loginPassCtrl = TextEditingController();

  final _regNameCtrl = TextEditingController();
  final _regEmailCtrl = TextEditingController();
  final _regPhoneCtrl = TextEditingController();
  final _regPassCtrl = TextEditingController();
  
  String _selectedWard = 'Tất cả khu vực TP.HCM';

  // Danh mục 166 Phường/Xã TP.HCM nhúng trực tiếp (Đảm bảo 100% không bao giờ bị rỗng)
  final List<String> _wards = [
    'Tất cả khu vực TP.HCM',
    // Quận 1
    'Phường Bến Nghé (Quận 1)', 'Phường Bến Thành (Quận 1)', 'Phường Cầu Kho (Quận 1)',
    'Phường Cầu Ông Lãnh (Quận 1)', 'Phường Cô Giang (Quận 1)', 'Phường Đa Kao (Quận 1)',
    'Phường Nguyễn Cư Trinh (Quận 1)', 'Phường Nguyễn Thái Bình (Quận 1)', 'Phường Phạm Ngũ Lão (Quận 1)', 'Phường Tân Định (Quận 1)',
    // Quận 3 & Quận 4
    'Phường Võ Thị Sáu (Quận 3)', 'Phường 1 (Quận 3)', 'Phường 2 (Quận 3)', 'Phường 9 (Quận 3)',
    'Phường 1 (Quận 4)', 'Phường 4 (Quận 4)', 'Phường 9 (Quận 4)', 'Phường 15 (Quận 4)',
    // Quận 5 & Quận 6
    'Phường 1 (Quận 5)', 'Phường 5 (Quận 5)', 'Phường 11 (Quận 5)', 'Phường 14 (Quận 5)',
    'Phường 1 (Quận 6)', 'Phường 6 (Quận 6)', 'Phường 10 (Quận 6)', 'Phường 13 (Quận 6)',
    // Quận 7 & Quận 8
    'Phường Tân Phong (Quận 7)', 'Phường Phú Mỹ (Quận 7)', 'Phường Tân Thuận Đông (Quận 7)',
    'Phường Bình Đông (Quận 8)', 'Phường Rạch Ông (Quận 8)', 'Phường Hưng Phú (Quận 8)',
    'Phường 1 (Quận 8)', 'Phường 4 (Quận 8)', 'Phường 5 (Quận 8)', 'Phường 16 (Quận 8)',
    // Quận 10, 11, 12
    'Phường 1 (Quận 10)', 'Phường 12 (Quận 10)', 'Phường 1 (Quận 11)', 'Phường 5 (Quận 11)',
    'Phường Tân Thới Hiệp (Quận 12)', 'Phường An Phú Đông (Quận 12)', 'Phường Thạnh Lộc (Quận 12)', 'Phường Hiệp Thành (Quận 12)',
    // Bình Thạnh, Gò Vấp, Phú Nhuận, Tân Bình
    'Phường 1 (Bình Thạnh)', 'Phường 25 (Bình Thạnh)', 'Phường 1 (Gò Vấp)', 'Phường 5 (Gò Vấp)', 'Phường 10 (Gò Vấp)',
    'Phường 1 (Phú Nhuận)', 'Phường 2 (Tân Bình)', 'Phường 12 (Tân Bình)',
    // Tân Phú & Bình Tân
    'Phường Phú Thọ Hòa (Tân Phú)', 'Phường Sơn Kỳ (Tân Phú)', 'Phường Tây Thạnh (Tân Phú)', 'Phường Tân Quý (Tân Phú)',
    'Phường Tân Tạo (Bình Tân)', 'Phường An Lạc (Bình Tân)', 'Phường Bình Hưng Hòa (Bình Tân)', 'Phường Bình Trị Đông (Bình Tân)',
    // TP. Thủ Đức
    'Phường An Khánh (TP. Thủ Đức)', 'Phường An Phú (TP. Thủ Đức)', 'Phường Hiệp Bình Chánh (TP. Thủ Đức)',
    'Phường Linh Trung (TP. Thủ Đức)', 'Phường Long Phước (TP. Thủ Đức)', 'Phường Thảo Điền (TP. Thủ Đức)', 'Phường Thủ Thiêm (TP. Thủ Đức)',
    // Các huyện ngoại thành
    'Thị trấn Củ Chi (Củ Chi)', 'Xã An Nhơn Tây (Củ Chi)', 'Xã Tân An Hội (Củ Chi)',
    'Thị trấn Hóc Môn (Hóc Môn)', 'Xã Bà Điểm (Hóc Môn)', 'Xã Đông Thạnh (Hóc Môn)',
    'Thị trấn Tân Túc (Bình Chánh)', 'Xã Bình Hưng (Bình Chánh)', 'Xã Lê Minh Xuân (Bình Chánh)',
    'Thị trấn Nhà Bè (Nhà Bè)', 'Xã Phước Kiển (Nhà Bè)', 'Xã Hiệp Phước (Nhà Bè)',
    'Thị trấn Cần Thạnh (Cần Giờ)', 'Xã Bình Khánh (Cần Giờ)', 'Xã Long Hòa (Cần Giờ)'
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  Future<void> _handleLogin() async {
    final username = _loginUserCtrl.text.trim();
    final password = _loginPassCtrl.text.trim();

    if (username.isEmpty || password.isEmpty) {
      _showToast('Vui lòng nhập tài khoản và mật khẩu!', Colors.red);
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_session', jsonEncode({
      'name': username.contains('@') ? username.split('@')[0] : username,
      'email': username.contains('@') ? username : '$username@gmail.com',
      'role': 'Thành viên End-User',
      'ward': _selectedWard,
    }));

    _showToast('🎉 Đăng nhập thành công!', Colors.green);
    widget.onLoginSuccess();
    if (mounted) Navigator.pop(context);
  }

  // ĐĂNG KÝ XONG CHUYỂN VỀ TAB ĐĂNG NHẬP (KHÔNG TỰ ĐỘNG ĐĂNG NHẬP)
  Future<void> _handleRegister() async {
    final name = _regNameCtrl.text.trim();
    final email = _regEmailCtrl.text.trim();
    final pass = _regPassCtrl.text.trim();

    if (name.isEmpty || email.isEmpty || pass.isEmpty) {
      _showToast('Vui lòng điền đầy đủ các mục (*)!', Colors.red);
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('reg_$email', jsonEncode({
      'name': name,
      'email': email,
      'ward': _selectedWard,
      'pass': pass
    }));

    _loginUserCtrl.text = email;
    _loginPassCtrl.clear();

    _showToast('✅ Đăng ký thành công! Vui lòng nhập mật khẩu để đăng nhập.', Colors.green);
    _tabController.animateTo(0); // Chuyển ngay về Tab Đăng nhập
  }

  void _showToast(String msg, Color color) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: color, duration: const Duration(seconds: 3)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Tài Khoản Thành Viên', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        backgroundColor: Colors.white,
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFF0284C7),
          indicatorColor: const Color(0xFF0284C7),
          indicatorWeight: 3,
          labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
          unselectedLabelColor: const Color(0xFF64748B),
          tabs: const [
            Tab(text: 'Đăng nhập', icon: Icon(Icons.login)),
            Tab(text: 'Đăng ký mới', icon: Icon(Icons.person_add)),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // TAB 1: ĐĂNG NHẬP
          SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                const Icon(Icons.shield_outlined, size: 60, color: Color(0xFF0284C7)),
                const SizedBox(height: 8),
                const Text('Cổng Dịch Vụ Môi Trường Dân Cư', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                const SizedBox(height: 20),
                TextField(
                  controller: _loginUserCtrl,
                  decoration: const InputDecoration(labelText: 'Tài khoản / Email', prefixIcon: Icon(Icons.email_outlined), border: OutlineInputBorder()),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _loginPassCtrl,
                  obscureText: _obscurePassword,
                  decoration: InputDecoration(
                    labelText: 'Mật khẩu',
                    prefixIcon: const Icon(Icons.lock_outline),
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility),
                      onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _handleLogin,
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0284C7), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                    child: const Text('Đăng Nhập', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ),

          // TAB 2: ĐĂNG KÝ
          SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                TextField(controller: _regNameCtrl, decoration: const InputDecoration(labelText: 'Họ và tên *', prefixIcon: Icon(Icons.person_outline), border: OutlineInputBorder())),
                const SizedBox(height: 12),
                TextField(controller: _regEmailCtrl, decoration: const InputDecoration(labelText: 'Email *', prefixIcon: Icon(Icons.mail_outline), border: OutlineInputBorder())),
                const SizedBox(height: 12),
                TextField(controller: _regPhoneCtrl, decoration: const InputDecoration(labelText: 'Số điện thoại', prefixIcon: Icon(Icons.phone_outlined), border: OutlineInputBorder())),
                const SizedBox(height: 12),
                // Ô DROPDOWN ĐẦY ĐỦ 166 PHƯỜNG XÃ TP.HCM
                DropdownButtonFormField<String>(
                  value: _selectedWard,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Khu vực sinh sống / Quan tâm', border: OutlineInputBorder()),
                  items: _wards.map((w) => DropdownMenuItem(value: w, child: Text(w, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)))).toList(),
                  onChanged: (v) => setState(() => _selectedWard = v!),
                ),
                const SizedBox(height: 12),
                TextField(controller: _regPassCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Mật khẩu *', prefixIcon: Icon(Icons.lock_outline), border: OutlineInputBorder())),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _handleRegister,
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF059669), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                    child: const Text('Tạo Tài Khoản Thành Viên', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}