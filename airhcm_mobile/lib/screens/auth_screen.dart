import 'dart:convert';
import 'package:flutter/material.dart';
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

  // Controller Đăng nhập
  final _loginUserCtrl = TextEditingController();
  final _loginPassCtrl = TextEditingController();

  // Controller Đăng ký
  final _regNameCtrl = TextEditingController();
  final _regEmailCtrl = TextEditingController();
  final _regPhoneCtrl = TextEditingController();
  final _regPassCtrl = TextEditingController();
  String _selectedWard = 'Tất cả khu vực TP.HCM';

  final List<String> _wards = [
    'Tất cả khu vực TP.HCM',
    'Phường Bến Thành (Quận 1)',
    'Phường Bình Đông (Quận 8)',
    'Phường Tân Tạo (Bình Tân)',
    'Phường Phú Thọ Hòa (Tân Phú)',
    'Phường Tân Thới Hiệp (Quận 12)',
    'Phường Long Phước (TP. Thủ Đức)',
    'Trung tâm Củ Chi'
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  // Xử lý đăng nhập End-User
  Future<void> _handleLogin() async {
    final username = _loginUserCtrl.text.trim();
    final password = _loginPassCtrl.text.trim();

    if (username.isEmpty || password.isEmpty) {
      _showToast('Vui lòng nhập đầy đủ thông tin đăng nhập!', Colors.red);
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    // Lưu session người dùng
    await prefs.setString('user_session', jsonEncode({
      'name': username.contains('@') ? username.split('@')[0] : username,
      'email': username.contains('@') ? username : '$username@gmail.com',
      'role': 'Thành viên End-User',
      'ward': 'TP. Hồ Chí Minh',
      'joined': 'Tháng 10/2026'
    }));

    _showToast('🎉 Đăng nhập thành công! Chào mừng bạn quay trở lại.', Colors.green);
    widget.onLoginSuccess();
    if (mounted) Navigator.pop(context);
  }

  // Xử lý đăng ký thành viên mới
  Future<void> _handleRegister() async {
    final name = _regNameCtrl.text.trim();
    final email = _regEmailCtrl.text.trim();
    final phone = _regPhoneCtrl.text.trim();
    final pass = _regPassCtrl.text.trim();

    if (name.isEmpty || email.isEmpty || pass.isEmpty) {
      _showToast('Vui lòng điền đầy đủ các mục bắt buộc (*)!', Colors.red);
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_session', jsonEncode({
      'name': name,
      'email': email,
      'phone': phone,
      'role': 'Thành viên End-User',
      'ward': _selectedWard,
      'joined': 'Hôm nay'
    }));

    _showToast('✅ Đăng ký tài khoản thành công!', Colors.green);
    widget.onLoginSuccess();
    if (mounted) Navigator.pop(context);
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
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Center(
                  child: Icon(Icons.shield_outlined, size: 64, color: Color(0xFF0284C7)),
                ),
                const SizedBox(height: 12),
                const Center(
                  child: Text('Cổng Dịch Vụ Môi Trường Dân Cư', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFF0F172A))),
                ),
                const Center(
                  child: Text('Đăng nhập để nhận cảnh báo ô nhiễm tức thời theo nơi ở', style: TextStyle(fontSize: 12.5, color: Color(0xFF64748B))),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _loginUserCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Tài khoản / Email',
                    prefixIcon: Icon(Icons.email_outlined),
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
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
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _handleLogin,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0284C7),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Đăng Nhập', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),

          // TAB 2: ĐĂNG KÝ
          SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _regNameCtrl,
                  decoration: const InputDecoration(labelText: 'Họ và tên *', prefixIcon: Icon(Icons.person_outline), border: OutlineInputBorder()),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _regEmailCtrl,
                  decoration: const InputDecoration(labelText: 'Email nhận thông báo *', prefixIcon: Icon(Icons.mail_outline), border: OutlineInputBorder()),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _regPhoneCtrl,
                  decoration: const InputDecoration(labelText: 'Số điện thoại', prefixIcon: Icon(Icons.phone_outlined), border: OutlineInputBorder()),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: _selectedWard,
                  decoration: const InputDecoration(labelText: 'Khu vực sinh sống / Quan tâm', border: OutlineInputBorder()),
                  items: _wards.map((w) => DropdownMenuItem(value: w, child: Text(w, style: const TextStyle(fontSize: 13)))).toList(),
                  onChanged: (v) => setState(() => _selectedWard = v!),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _regPassCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Mật khẩu bảo mật *', prefixIcon: Icon(Icons.lock_outline), border: OutlineInputBorder()),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _handleRegister,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF059669),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Tạo Tài Khoản Thành Viên', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
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