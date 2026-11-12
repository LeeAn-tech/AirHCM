import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'core/alarm_service.dart';
import 'core/api_config.dart';
import 'core/app_state.dart';
import 'core/notification_service.dart';
import 'firebase_options.dart';
import 'screens/alert_screen.dart';
import 'screens/dss_screen.dart';
import 'screens/forecast_screen.dart';
import 'screens/map_screen.dart';
import 'screens/news_screen.dart';
import 'widgets/ui.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Cấu hình máy chủ & tùy chọn người dùng lưu trong máy
  await ApiConfig.load();
  await AppState.loadPreferences();

  // Firebase (Push cảnh báo) - lỗi khởi tạo không làm dừng ứng dụng
  var firebaseReady = false;
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
    firebaseReady = true;
  } catch (e) {
    debugPrint('Firebase chưa sẵn sàng: $e');
  }

  runApp(const AirHCMMobileApp());

  // Đổi máy chủ (tự dò thấy IP mới / người dùng lưu) -> làm mới số liệu & cảnh báo dùng chung
  ApiConfig.serverNotifier.addListener(AppState.refreshShared);
  // Router có thể đã cấp IP mới cho máy tính chạy Backend -> tự dò trong mạng Wi-Fi
  ApiConfig.ensureReachable();

  // Kênh thông báo có tiếng còi phải sẵn sàng trước khi nhận Push / đánh giá cảnh báo
  await AlarmService.init();
  if (firebaseReady) await NotificationService.init();
  AppState.startAutoRefresh();
}

class AirHCMMobileApp extends StatelessWidget {
  const AirHCMMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brand,
      primary: AppColors.brand,
      surface: Colors.white,
    );
    return MaterialApp(
      title: 'AirHCM Mobile',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: NotificationService.messengerKey,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: AppColors.bg,
        fontFamily: 'Roboto',
        appBarTheme: const AppBarTheme(
          backgroundColor: AppColors.bg,
          surfaceTintColor: Colors.transparent,
          foregroundColor: AppColors.text,
          elevation: 0,
          scrolledUnderElevation: 0,
        ),
        chipTheme: ChipThemeData(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          side: const BorderSide(color: AppColors.line),
          labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
        ),
        snackBarTheme: SnackBarThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
      ),
      home: const MainNavigationScreen(),
    );
  }
}

class MainNavigationScreen extends StatelessWidget {
  const MainNavigationScreen({super.key});

  static const List<Widget> _screens = [
    MapScreen(),
    ForecastAIScreen(),
    DssScreen(),
    AlertSubscriptionScreen(),
    NewsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: AppState.tabIndex,
      builder: (context, index, _) => Scaffold(
        // IndexedStack giữ nguyên trạng thái từng tab (bản đồ, hội thoại AI) khi chuyển qua lại
        body: SafeArea(child: IndexedStack(index: index, children: _screens)),
        bottomNavigationBar: ValueListenableBuilder<Map<String, dynamic>?>(
          valueListenable: AppState.alert,
          builder: (context, alert, _) {
            final warning = alert?['status'] == 'WARNING';
            return NavigationBar(
              selectedIndex: index,
              onDestinationSelected: (i) => AppState.tabIndex.value = i,
              backgroundColor: Colors.white,
              indicatorColor: const Color(0xFFE0F2FE),
              elevation: 8,
              labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
              destinations: [
                const NavigationDestination(
                  icon: Icon(Icons.map_outlined),
                  selectedIcon: Icon(Icons.map, color: AppColors.brand),
                  label: 'Bản đồ',
                ),
                const NavigationDestination(
                  icon: Icon(Icons.insights_outlined),
                  selectedIcon: Icon(Icons.insights, color: AppColors.brand),
                  label: 'Dự báo AI',
                ),
                const NavigationDestination(
                  icon: Icon(Icons.smart_toy_outlined),
                  selectedIcon: Icon(Icons.smart_toy, color: AppColors.brand),
                  label: 'Trợ lý AI',
                ),
                NavigationDestination(
                  icon: Badge(isLabelVisible: warning, backgroundColor: AppColors.danger, child: const Icon(Icons.notifications_outlined)),
                  selectedIcon: Badge(isLabelVisible: warning, backgroundColor: AppColors.danger, child: const Icon(Icons.notifications, color: AppColors.brand)),
                  label: 'Cảnh báo',
                ),
                const NavigationDestination(
                  icon: Icon(Icons.newspaper_outlined),
                  selectedIcon: Icon(Icons.newspaper, color: AppColors.brand),
                  label: 'Bản tin',
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
