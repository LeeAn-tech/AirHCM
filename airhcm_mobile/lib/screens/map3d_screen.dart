import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart' hide Path;
import 'package:webview_flutter/webview_flutter.dart';

import '../core/api_config.dart';
import '../widgets/location_insight_sheet.dart';
import '../widgets/ui.dart';

/// Bản đồ 3D diễn biến chất lượng không khí - giống chế độ 3D của WebGIS.
///
/// flutter_map chỉ vẽ 2D nên màn hình này mở trang `m3d.html` của máy chủ AirHCM trong WebView
/// (MapLibre GL / WebGL, cùng dữ liệu /api/v1/air/spatial-series với WebGIS). Trạng thái của app
/// (vị trí, mức thu phóng, giờ mô phỏng, chuẩn AQI, bản đồ nền) được truyền sang trang; trang gửi
/// ngược lại phường được chạm (mở bảng phân tích gốc của app) và giờ đang xem (đồng bộ khi quay lại).
class Map3DScreen extends StatefulWidget {
  final LatLng center;
  final double zoom;
  final String basemap;
  final bool useUS;

  const Map3DScreen({
    super.key,
    required this.center,
    required this.zoom,
    required this.basemap,
    required this.useUS,
  });

  /// Mở bản đồ 3D (luôn ở thời điểm hiện tại); trả về giờ đang xem "YYYY-MM-DD HH:00" để bản đồ 2D
  /// nhảy tới đúng mốc đó trên thanh dự báo
  static Future<String?> open(BuildContext context,
          {required LatLng center, required double zoom, required String basemap, required bool useUS}) =>
      Navigator.push<String?>(
        context,
        MaterialPageRoute(
          builder: (_) => Map3DScreen(center: center, zoom: zoom, basemap: basemap, useUS: useUS),
        ),
      );

  @override
  State<Map3DScreen> createState() => _Map3DScreenState();
}

class _Map3DScreenState extends State<Map3DScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _error;
  String? _viewTime; // "YYYY-MM-DD HH:00" đang xem trên bản đồ 3D

  Uri get _uri => Uri.parse('${ApiConfig.server}/m3d.html').replace(queryParameters: {
        'lat': widget.center.latitude.toStringAsFixed(5),
        'lng': widget.center.longitude.toStringAsFixed(5),
        'zoom': widget.zoom.toStringAsFixed(2),
        'standard': widget.useUS ? 'US' : 'VN',
        'basemap': widget.basemap,
      });

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFE8EEF5))
      ..addJavaScriptChannel('AirHCM', onMessageReceived: _onMessage)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: (err) {
          // Chỉ báo lỗi khi không tải được chính trang (ảnh nền bản đồ lỗi lẻ tẻ thì bỏ qua)
          if (err.isForMainFrame ?? true) {
            if (mounted) {
              setState(() {
                _loading = false;
                _error = 'Không mở được bản đồ 3D từ máy chủ ${ApiConfig.server}.\n${err.description}';
              });
            }
          }
        },
      ))
      ..loadRequest(_uri);
  }

  void _onMessage(JavaScriptMessage message) {
    Map<String, dynamic> msg;
    try {
      msg = Map<String, dynamic>.from(jsonDecode(message.message) as Map);
    } catch (_) {
      return;
    }
    switch (msg['type']) {
      case 'time':
        _viewTime = msg['time']?.toString();
      case 'ward':
        final lat = (msg['lat'] as num?)?.toDouble();
        final lng = (msg['lng'] as num?)?.toDouble();
        if (lat != null && lng != null && mounted) {
          LocationInsightSheet.show(context, LatLng(lat, lng),
              title: '${msg['name'] ?? 'Phân tích phường'}', wardCode: msg['code']?.toString());
        }
    }
  }


  void _retry() {
    setState(() {
      _error = null;
      _loading = true;
    });
    _controller.loadRequest(_uri);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<String?>(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _viewTime);
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFE8EEF5),
        appBar: AppBar(
          title: const Text('Bản đồ 3D', style: TextStyle(fontWeight: FontWeight.w800)),
          leading: BackButton(onPressed: () => Navigator.pop(context, _viewTime)),
          actions: [
            IconButton(tooltip: 'Tải lại', onPressed: _retry, icon: const Icon(Icons.refresh)),
          ],
        ),
        body: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (_loading && _error == null)
              const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 3)),
            if (_error != null)
              Positioned.fill(
                child: Container(
                  color: const Color(0xFFF1F5F9),
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.view_in_ar, size: 48, color: AppColors.muted),
                      const SizedBox(height: 12),
                      Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.text2, height: 1.45)),
                      const SizedBox(height: 16),
                      FilledButton.icon(onPressed: _retry, icon: const Icon(Icons.refresh), label: const Text('Thử lại')),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
