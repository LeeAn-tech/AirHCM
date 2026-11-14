import 'package:flutter/material.dart';

import '../core/api_service.dart';
import '../core/app_state.dart';
import '../core/social_auth.dart';
import '../core/ward_catalog.dart';
import '../widgets/ui.dart';

/// Đăng nhập / Đăng ký thành viên - dùng chung tài khoản với WebGIS AirHCM
/// (tài khoản hiển thị trong trang Quản trị > Quản lý Thành viên).
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 2, vsync: this);
  bool _obscure = true;
  bool _busy = false;
  SocialProvider? _socialBusy;

  final _loginEmailCtrl = TextEditingController();
  final _loginPassCtrl = TextEditingController();
  final _regNameCtrl = TextEditingController();
  final _regEmailCtrl = TextEditingController();
  final _regPassCtrl = TextEditingController();

  static const _allWards = 'Tất cả TP.HCM';
  String _selectedWard = _allWards;
  List<String> _wardNames = const [_allWards];

  @override
  void initState() {
    super.initState();
    WardCatalog.load().then((wards) {
      if (mounted) setState(() => _wardNames = [_allWards, ...wards.map((w) => w.displayName)]);
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    for (final c in [_loginEmailCtrl, _loginPassCtrl, _regNameCtrl, _regEmailCtrl, _regPassCtrl]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _login() async {
    final email = _loginEmailCtrl.text.trim();
    final pass = _loginPassCtrl.text.trim();
    if (!email.contains('@') || pass.isEmpty) {
      _toast('Vui lòng nhập email và mật khẩu hợp lệ!', AppColors.danger);
      return;
    }
    await _run(() async {
      final user = await ApiService.login(email, pass);
      await AppState.saveUser({...user, 'ward': AppState.user.value?['ward'] ?? _selectedWard});
      _toast('🎉 Chào mừng ${user['fullname'] ?? ''} quay lại AirHCM!', AppColors.success);
      if (mounted) Navigator.pop(context);
    });
  }

  Future<void> _register() async {
    final name = _regNameCtrl.text.trim();
    final email = _regEmailCtrl.text.trim();
    final pass = _regPassCtrl.text.trim();
    if (name.isEmpty || !email.contains('@') || pass.length < 6) {
      _toast('Nhập đủ họ tên, email hợp lệ và mật khẩu từ 6 ký tự!', AppColors.danger);
      return;
    }
    await _run(() async {
      final user = await ApiService.register(name, email, pass);
      await AppState.saveUser({...user, 'ward': _selectedWard});
      _toast('✅ Tạo tài khoản thành công! Tài khoản dùng chung trên WebGIS AirHCM.', AppColors.success);
      if (mounted) Navigator.pop(context);
    });
  }

  /// Đăng nhập / đăng ký bằng Google, Facebook, Apple (tài khoản dùng chung với WebGIS)
  Future<void> _social(SocialProvider provider) async {
    setState(() {
      _busy = true;
      _socialBusy = provider;
    });
    try {
      final user = await SocialAuth.signIn(provider);
      await AppState.saveUser({...user, 'ward': AppState.user.value?['ward'] ?? _selectedWard});
      _toast('🎉 Chào mừng ${user['fullname'] ?? ''}! Đã đăng nhập bằng ${SocialAuth.label(provider)}.', AppColors.success);
      if (mounted) Navigator.pop(context);
    } on SocialAuthCancelled {
      // Người dùng tự đóng cửa sổ đăng nhập
    } catch (e) {
      _toast('$e', AppColors.danger);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _socialBusy = null;
        });
      }
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      _toast('$e', AppColors.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg, Color color) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: color, behavior: SnackBarBehavior.floating),
    );
  }

  InputDecoration _input(String label, IconData icon, {Widget? suffix}) => InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        suffixIcon: suffix,
        filled: true,
        fillColor: AppColors.surface2,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.line)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.line)),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Tài khoản thành viên', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        actions: [
          IconButton(
            tooltip: 'Cài đặt máy chủ',
            icon: const Icon(Icons.dns_outlined),
            onPressed: () => ServerSettingsSheet.show(context),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelStyle: const TextStyle(fontWeight: FontWeight.w800),
          tabs: const [Tab(text: 'Đăng nhập'), Tab(text: 'Đăng ký mới')],
        ),
      ),
      body: AbsorbPointer(
        absorbing: _busy,
        child: TabBarView(
          controller: _tabController,
          children: [_loginTab(), _registerTab()],
        ),
      ),
    );
  }

  Widget _hero(String title, String subtitle) {
    return Column(
      children: [
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            gradient: AppColors.brandGradient,
            borderRadius: BorderRadius.circular(22),
            boxShadow: const [BoxShadow(color: Color(0x660284C7), blurRadius: 18, offset: Offset(0, 8))],
          ),
          child: const Icon(Icons.air, color: Colors.white, size: 36),
        ),
        const SizedBox(height: 14),
        Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        const SizedBox(height: 4),
        Text(subtitle, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
        const SizedBox(height: 22),
      ],
    );
  }

  Widget _submit(String label, VoidCallback onPressed) {
    return SizedBox(
      width: double.infinity,
      height: 50,
      child: FilledButton(
        style: FilledButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
        onPressed: _busy ? null : onPressed,
        child: _busy && _socialBusy == null
            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
            : Text(label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      ),
    );
  }

  /// Apple ID tạm ẩn (giống WebGIS): cần tài khoản Apple Developer trả phí. Khi có, đổi thành true -
  /// SocialAuth và Backend đã hỗ trợ sẵn.
  static const bool _appleSignInEnabled = false;

  /// Cụm nút đăng nhập nhanh giống WebGIS: Google · Facebook
  Widget _socialBlock() {
    return Column(
      children: [
        _socialButton(
          SocialProvider.google,
          'Tiếp tục với Google',
          background: Colors.white,
          foreground: AppColors.text,
          border: const BorderSide(color: Color(0xFFCBD5E1), width: 1.4),
          icon: const Text('G', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: Color(0xFF4285F4))),
        ),
        const SizedBox(height: 10),
        _socialButton(
          SocialProvider.facebook,
          'Tiếp tục với Facebook',
          background: const Color(0xFF1877F2),
          foreground: Colors.white,
          icon: const Icon(Icons.facebook, size: 21, color: Colors.white),
        ),
        if (_appleSignInEnabled) ...[
          const SizedBox(height: 10),
          _socialButton(
            SocialProvider.apple,
            'Đăng nhập bằng Apple ID',
            background: Colors.black,
            foreground: Colors.white,
            icon: const Icon(Icons.apple, size: 22, color: Colors.white),
          ),
        ],
        const SizedBox(height: 20),
        const Row(
          children: [
            Expanded(child: Divider(color: AppColors.line)),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 12),
              child: Text('HOẶC BẰNG EMAIL',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.1, color: AppColors.muted)),
            ),
            Expanded(child: Divider(color: AppColors.line)),
          ],
        ),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _socialButton(SocialProvider provider, String label,
      {required Color background, required Color foreground, required Widget icon, BorderSide? border}) {
    final loading = _socialBusy == provider;
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: ElevatedButton(
        onPressed: _busy ? null : () => _social(provider),
        style: ElevatedButton.styleFrom(
          backgroundColor: background,
          foregroundColor: foreground,
          disabledBackgroundColor: background.withValues(alpha: loading ? 1 : 0.55),
          disabledForegroundColor: foreground.withValues(alpha: loading ? 1 : 0.7),
          elevation: 0,
          side: border,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 24,
              child: Center(
                child: loading
                    ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: foreground))
                    : icon,
              ),
            ),
            const SizedBox(width: 10),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
          ],
        ),
      ),
    );
  }

  Widget _loginTab() {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        _hero('Đăng nhập AirHCM', 'Dùng chung tài khoản với Cổng WebGIS AirHCM'),
        _socialBlock(),
        TextField(controller: _loginEmailCtrl, keyboardType: TextInputType.emailAddress, decoration: _input('Email', Icons.email_outlined)),
        const SizedBox(height: 14),
        TextField(
          controller: _loginPassCtrl,
          obscureText: _obscure,
          decoration: _input('Mật khẩu', Icons.lock_outline,
              suffix: IconButton(
                icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                onPressed: () => setState(() => _obscure = !_obscure),
              )),
        ),
        const SizedBox(height: 22),
        _submit('Đăng nhập', _login),
        const SizedBox(height: 12),
        TextButton(onPressed: () => _tabController.animateTo(1), child: const Text('Chưa có tài khoản? Đăng ký ngay')),
      ],
    );
  }

  Widget _registerTab() {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        _hero('Tạo tài khoản mới', 'Nhận cảnh báo ô nhiễm & tư vấn sức khỏe cá nhân hóa'),
        _socialBlock(),
        TextField(controller: _regNameCtrl, decoration: _input('Họ và tên *', Icons.person_outline)),
        const SizedBox(height: 12),
        TextField(controller: _regEmailCtrl, keyboardType: TextInputType.emailAddress, decoration: _input('Email *', Icons.mail_outline)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _selectedWard,
          isExpanded: true,
          menuMaxHeight: 420,
          decoration: _input('Khu vực sinh sống / quan tâm', Icons.location_city_outlined),
          items: _wardNames
              .map((w) => DropdownMenuItem(value: w, child: Text(w, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5))))
              .toList(),
          onChanged: (v) => setState(() => _selectedWard = v ?? _allWards),
        ),
        const SizedBox(height: 12),
        TextField(controller: _regPassCtrl, obscureText: true, decoration: _input('Mật khẩu (tối thiểu 6 ký tự) *', Icons.lock_outline)),
        const SizedBox(height: 22),
        _submit('Tạo tài khoản', _register),
      ],
    );
  }
}
