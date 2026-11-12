import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

import 'api_service.dart';

enum SocialProvider { google, facebook, apple }

/// Người dùng tự đóng cửa sổ đăng nhập - không cần báo lỗi
class SocialAuthCancelled implements Exception {}

/// Đăng nhập / đăng ký bằng Google, Facebook, Apple - đồng bộ với WebGIS AirHCM:
/// Firebase Authentication mở trang đăng nhập THẬT của nhà cung cấp (Chrome Custom Tab),
/// lấy Firebase ID token rồi Backend xác minh token và tạo / trả về tài khoản thành viên.
class SocialAuth {
  SocialAuth._();

  static String label(SocialProvider p) => switch (p) {
        SocialProvider.google => 'Google',
        SocialProvider.facebook => 'Facebook',
        SocialProvider.apple => 'Apple',
      };

  static AuthProvider _provider(SocialProvider p) => switch (p) {
        // Luôn hiện danh sách tài khoản Google trên máy để người dùng chọn
        SocialProvider.google => GoogleAuthProvider()..setCustomParameters({'prompt': 'select_account'}),
        SocialProvider.facebook => FacebookAuthProvider()
          ..addScope('email')
          ..addScope('public_profile'),
        SocialProvider.apple => AppleAuthProvider()
          ..addScope('email')
          ..addScope('name'),
      };

  /// Trả về tài khoản AirHCM (Map) hoặc ném [ApiException] / [SocialAuthCancelled]
  static Future<Map<String, dynamic>> signIn(SocialProvider p) async {
    final name = label(p);
    if (Firebase.apps.isEmpty) {
      throw ApiException('Firebase chưa sẵn sàng trên thiết bị này nên chưa thể đăng nhập bằng $name.');
    }
    final auth = FirebaseAuth.instance;
    try {
      final provider = _provider(p);
      final cred = kIsWeb ? await auth.signInWithPopup(provider) : await auth.signInWithProvider(provider);
      final user = cred.user;
      final token = await user?.getIdToken();
      if (user == null || token == null) throw ApiException('$name không trả về thông tin tài khoản.');
      return await ApiService.socialLogin(token, fullname: user.displayName);
    } on FirebaseAuthException catch (e) {
      final message = describe(e, name);
      if (message == null) throw SocialAuthCancelled();
      throw ApiException(message);
    } finally {
      // Phiên AirHCM lưu trong máy (AppState); không giữ phiên Firebase
      try {
        await auth.signOut();
      } catch (_) {}
    }
  }

  /// Thông báo lỗi dễ hiểu; null = người dùng tự đóng cửa sổ đăng nhập
  static String? describe(FirebaseAuthException e, String name) {
    debugPrint('Đăng nhập $name lỗi: ${e.code} - ${e.message}');
    switch (e.code) {
      case 'web-context-canceled':
      case 'web-context-cancelled':
      case 'canceled':
      case 'popup-closed-by-user':
      case 'cancelled-popup-request':
        return null;
      case 'operation-not-allowed':
        return 'Đăng nhập bằng $name chưa được bật. Quản trị viên cần bật $name trong Firebase Console → Authentication → Sign-in method.';
      case 'account-exists-with-different-credential':
        return 'Email của tài khoản này đã dùng để đăng nhập bằng phương thức khác. Hãy đăng nhập bằng phương thức bạn đã dùng trước đó.';
      case 'network-request-failed':
      case 'web-network-request-failed':
        return 'Không kết nối được máy chủ xác thực. Vui lòng kiểm tra Internet và thử lại.';
      case 'web-context-already-presented':
        return 'Cửa sổ đăng nhập đang mở. Vui lòng hoàn tất hoặc đóng cửa sổ đó.';
      case 'app-not-authorized':
        return 'Ứng dụng chưa được cấp quyền dùng Firebase Authentication (kiểm tra SHA-1 của ứng dụng trong Firebase).';
      case 'user-disabled':
        return 'Tài khoản $name này đã bị vô hiệu hóa.';
      case 'invalid-credential':
        return 'Cấu hình đăng nhập $name trên Firebase chưa đúng (App ID / Secret / Service ID).';
      default:
        final msg = e.message ?? '';
        if (msg.contains('CONFIGURATION_NOT_FOUND')) {
          return 'Dự án Firebase chưa kích hoạt Authentication cho $name.';
        }
        return msg.isNotEmpty ? 'Đăng nhập $name thất bại: $msg' : 'Đăng nhập $name thất bại (${e.code}).';
    }
  }
}
