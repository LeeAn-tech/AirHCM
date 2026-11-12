import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api_service.dart';
import '../widgets/ui.dart';

/// Bản tin môi trường đô thị (đồng bộ tab "Bản tin Môi trường" của WebGIS - /news)
class NewsScreen extends StatefulWidget {
  const NewsScreen({super.key});

  @override
  State<NewsScreen> createState() => _NewsScreenState();
}

class _NewsScreenState extends State<NewsScreen> {
  List<Map<String, dynamic>> _news = [];
  bool _loading = true;
  String? _error;
  String _category = 'ALL';

  static const Map<String, String> _categories = {
    'ALL': 'Tất cả',
    'PM25': 'Bụi mịn & AQI',
    'WEATHER': 'Khí quyển & Thời tiết',
    'POLICY': 'Quy chuẩn & Chỉ đạo',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await ApiService.news();
      _news = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _open(String? link) async {
    final uri = Uri.tryParse(link ?? '');
    if (uri == null) return;
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Không mở được liên kết bài viết.'), behavior: SnackBarBehavior.floating),
      );
    }
  }

  Color _badge(dynamic hex) {
    final s = '$hex'.replaceAll('#', '');
    final v = int.tryParse(s.length == 6 ? 'FF$s' : s, radix: 16);
    return v == null ? AppColors.brand : Color(v);
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _category == 'ALL' ? _news : _news.where((n) => n['category'] == _category).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bản tin môi trường', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        actions: [IconButton(tooltip: 'Làm mới', onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: [
            SizedBox(
              height: 40,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: _categories.entries
                    .map((e) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(e.value),
                            selected: _category == e.key,
                            onSelected: (_) => setState(() => _category = e.key),
                          ),
                        ))
                    .toList(),
              ),
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Padding(padding: EdgeInsets.symmetric(vertical: 60), child: Center(child: CircularProgressIndicator()))
            else if (_error != null)
              ErrorView(message: _error!, onRetry: _load)
            else if (filtered.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(child: Text('Chưa có bài viết trong chuyên mục này.', style: TextStyle(color: AppColors.muted))),
              )
            else
              for (var i = 0; i < filtered.length; i++) _card(filtered[i], featured: i == 0 && _category == 'ALL'),
          ],
        ),
      ),
    );
  }

  Widget _card(Map<String, dynamic> n, {bool featured = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        clipBehavior: Clip.antiAlias,
        elevation: 0,
        child: InkWell(
          onTap: () => _open(n['link']?.toString()),
          child: Container(
            decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(20)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Stack(
                  children: [
                    AspectRatio(
                      aspectRatio: featured ? 16 / 9 : 2.2,
                      child: Image.network(
                        '${n['image'] ?? ''}',
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => Container(
                          decoration: const BoxDecoration(gradient: AppColors.brandGradient),
                          child: const Center(child: Icon(Icons.eco_outlined, color: Colors.white70, size: 42)),
                        ),
                      ),
                    ),
                    Positioned(
                      left: 12,
                      top: 12,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: featured ? AppColors.danger : _badge(n['badge_color']), borderRadius: BorderRadius.circular(20)),
                        child: Text(featured ? '⚡ TIN TIÊU ĐIỂM' : '${n['source'] ?? ''}',
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${n['source'] ?? ''} · ${n['pub_date'] ?? ''}',
                          style: const TextStyle(fontSize: 11.5, color: AppColors.brand, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 6),
                      Text('${n['title'] ?? ''}',
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: featured ? 16.5 : 14.5, fontWeight: FontWeight.w800, height: 1.35, color: AppColors.text)),
                      const SizedBox(height: 6),
                      Text('${n['summary'] ?? ''}',
                          maxLines: featured ? 4 : 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, height: 1.45, color: AppColors.muted)),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(color: const Color(0xFFE0F2FE), borderRadius: BorderRadius.circular(20)),
                            child: Text('#${n['category'] ?? 'AirHCM'}',
                                style: const TextStyle(fontSize: 11, color: Color(0xFF0369A1), fontWeight: FontWeight.w700)),
                          ),
                          const Spacer(),
                          const Text('Đọc bài viết', style: TextStyle(fontSize: 12.5, color: AppColors.brand, fontWeight: FontWeight.w800)),
                          const Icon(Icons.arrow_forward, size: 16, color: AppColors.brand),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
