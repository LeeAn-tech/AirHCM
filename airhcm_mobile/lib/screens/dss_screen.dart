import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:lottie/lottie.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api_service.dart';
import '../core/app_state.dart';
import '../core/aqi_utils.dart';
import '../core/location_service.dart';
import '../widgets/ui.dart';

/// Trợ lý AI AirHCM (AI Agent) - tư vấn sức khỏe dựa trên DỮ LIỆU THẬT của hệ thống:
/// số liệu quan trắc, dự báo AI 24h theo phường, cảnh báo DSS (QCVN 05:2023), nhóm đối tượng
/// và lịch sử hội thoại. Khi mô hình ngôn ngữ không phản hồi, Backend trả lời bằng bộ luật DSS.
class DssScreen extends StatefulWidget {
  const DssScreen({super.key});

  @override
  State<DssScreen> createState() => _DssScreenState();
}

class _ChatMessage {
  final String role; // 'user' | 'ai'
  final String text;
  final String? source; // 'gemini' | 'dss-rules'
  final String? ward;
  final List<String> sources; // Nguồn tài liệu RAG: "[1] QCVN 05:2023/BTNMT · Giới hạn bụi mịn PM2.5"
  final DateTime time;

  _ChatMessage(this.role, this.text, {this.source, this.ward, this.sources = const [], DateTime? time})
      : time = time ?? DateTime.now();

  Map<String, dynamic> toJson() =>
      {'role': role, 'text': text, 'source': source, 'ward': ward, 'sources': sources, 'time': time.toIso8601String()};

  factory _ChatMessage.fromJson(Map<String, dynamic> j) => _ChatMessage(
        '${j['role']}',
        '${j['text']}',
        source: j['source'] as String?,
        ward: j['ward'] as String?,
        sources: (j['sources'] as List? ?? const []).map((e) => '$e').toList(),
        time: DateTime.tryParse('${j['time']}'),
      );

  /// Nhãn nguồn từ phản hồi /dss/advice (RAG kho tri thức)
  static List<String> sourceLabels(dynamic raw) => (raw as List? ?? const [])
      .whereType<Map>()
      .map((s) => '[${s['ref']}] ${'${s['title']}'.split(' – ').first} · ${s['section']}')
      .toList();
}

class _DssScreenState extends State<DssScreen> {
  static const _prefHistory = 'ai_chat_history_v2';
  static const _prefGroup = 'ai_user_group';

  final TextEditingController _controller = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final List<_ChatMessage> _messages = [];
  bool _loading = false;
  bool _useLocation = true;
  bool _locating = false;
  String _group = 'normal';

  static const Map<String, String> _groups = {
    'normal': 'Bình thường',
    'sensitive': 'Nhạy cảm',
    'respiratory': 'Bệnh hô hấp',
  };

  static const List<String> _suggestions = [
    'Khung giờ nào hôm nay tốt nhất để ra ngoài?',
    'Tôi có nên chạy bộ ngoài trời chiều nay không?',
    'Trẻ nhỏ và người già cần lưu ý gì hôm nay?',
    'Tôi nên dùng loại khẩu trang nào?',
    'Ngày mai không khí có tốt hơn không?',
  ];

  @override
  void initState() {
    super.initState();
    _restore();
    AppState.pendingQuestion.addListener(_onPendingQuestion);
    AppState.current.addListener(_refresh);
    AppState.alert.addListener(_refresh);
    AppState.lastLocation.addListener(_refresh);
    WidgetsBinding.instance.addPostFrameCallback((_) => _onPendingQuestion());
  }

  @override
  void dispose() {
    AppState.pendingQuestion.removeListener(_onPendingQuestion);
    AppState.current.removeListener(_refresh);
    AppState.alert.removeListener(_refresh);
    AppState.lastLocation.removeListener(_refresh);
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  void _onPendingQuestion() {
    final q = AppState.pendingQuestion.value;
    if (q == null || _loading) return;
    AppState.pendingQuestion.value = null;
    _send(q);
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    _group = prefs.getString(_prefGroup) ?? 'normal';
    final raw = prefs.getString(_prefHistory);
    if (raw != null) {
      try {
        final list = jsonDecode(raw) as List;
        _messages.addAll(list.map((e) => _ChatMessage.fromJson(Map<String, dynamic>.from(e))));
      } catch (_) {}
    }
    if (mounted) setState(() {});
    _scrollToEnd();
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    final recent = _messages.length > 40 ? _messages.sublist(_messages.length - 40) : _messages;
    await prefs.setString(_prefHistory, jsonEncode(recent.map((m) => m.toJson()).toList()));
    await prefs.setString(_prefGroup, _group);
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent + 120, duration: const Duration(milliseconds: 350), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _useMyLocation() async {
    setState(() => _locating = true);
    try {
      AppState.lastLocation.value = await LocationService.currentPosition();
      AppState.lastWardName = null;
      setState(() => _useLocation = true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'), behavior: SnackBarBehavior.floating));
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _send([String? preset]) async {
    final question = (preset ?? _controller.text).trim();
    if (question.isEmpty || _loading) return;

    final history = _messages
        .skip(_messages.length > 6 ? _messages.length - 6 : 0)
        .map((m) => {'role': m.role, 'text': m.text})
        .toList();

    setState(() {
      _messages.add(_ChatMessage('user', question));
      _loading = true;
      _controller.clear();
    });
    _scrollToEnd();

    final loc = _useLocation ? AppState.lastLocation.value : null;
    try {
      final data = await ApiService.askAdvisor(
        question: question,
        lat: loc?.latitude,
        lng: loc?.longitude,
        userGroup: _group,
        history: history,
        useUSAQI: AppState.useUSAQI.value,
      );
      final ctx = Map<String, dynamic>.from(data['context'] ?? {});
      if (ctx['ward'] != null) AppState.lastWardName = '${ctx['ward']}';
      _messages.add(_ChatMessage('ai', '${data['advice'] ?? ''}',
          source: data['source']?.toString(),
          ward: ctx['ward']?.toString(),
          sources: _ChatMessage.sourceLabels(data['sources'])));
    } catch (e) {
      _messages.add(_ChatMessage('ai', '**Không kết nối được máy chủ AirHCM.**\n\n$e', source: 'error'));
    } finally {
      if (mounted) setState(() => _loading = false);
      _persist();
      _scrollToEnd();
    }
  }

  Future<void> _clear() async {
    setState(() => _messages.clear());
    await _persist();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(gradient: AppColors.brandGradient, borderRadius: BorderRadius.circular(12)),
              child: const Icon(Icons.smart_toy_outlined, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 10),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Trợ lý AI AirHCM', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16.5)),
                Text('Tư vấn theo dữ liệu quan trắc & dự báo', style: TextStyle(fontSize: 11, color: AppColors.muted)),
              ],
            ),
          ],
        ),
        actions: [
          if (_messages.isNotEmpty)
            IconButton(tooltip: 'Xóa hội thoại', onPressed: _clear, icon: const Icon(Icons.delete_sweep_outlined)),
        ],
      ),
      body: Column(
        children: [
          _contextHeader(),
          Expanded(
            child: _messages.isEmpty && !_loading
                ? _welcome()
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                    itemCount: _messages.length + (_loading ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index == _messages.length) return _typing();
                      return _bubble(_messages[index]);
                    },
                  ),
          ),
          if (_messages.isNotEmpty && !_loading) _suggestionBar(),
          _inputBar(),
        ],
      ),
    );
  }

  Widget _contextHeader() {
    final cur = AppState.current.value;
    final alert = AppState.alert.value;
    final useUS = AppState.useUSAQI.value;
    final pm = AqiUtils.toDouble(cur?['pm2_5'], 0);
    final aqi = AqiUtils.compute(pm, useUS: useUS);
    final hasLoc = AppState.lastLocation.value != null;
    final locLabel = !_useLocation || !hasLoc
        ? 'Trạm Trung tâm TP.HCM'
        : (AppState.lastWardName != null ? 'Phường ${AppState.lastWardName}' : 'Vị trí đã chọn');

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        children: [
          Row(
            children: [
              if (cur != null) ...[
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: AqiUtils.color(aqi), width: 3.5),
                  ),
                  child: Center(child: Text('$aqi', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14))),
                ),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Icon(Icons.place_outlined, size: 14, color: AppColors.brand),
                      const SizedBox(width: 3),
                      Flexible(
                        child: Text(locLabel, maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                      ),
                    ]),
                    Text(
                      cur == null ? 'Đang đồng bộ số liệu...' : 'PM2.5 ${pm.toStringAsFixed(1)} µg/m³ · ${AqiUtils.standardLabel(useUS)} ${AqiUtils.shortLevel(aqi)}',
                      style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              if (alert?['status'] == 'WARNING')
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: const Color(0xFFFEE2E2), borderRadius: BorderRadius.circular(20)),
                  child: const Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.warning_amber_rounded, size: 14, color: AppColors.danger),
                    SizedBox(width: 3),
                    Text('Cảnh báo', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.danger)),
                  ]),
                ),
              IconButton(
                tooltip: 'Dùng vị trí GPS của tôi',
                onPressed: _locating ? null : _useMyLocation,
                icon: _locating
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(Icons.my_location, color: _useLocation && hasLoc ? AppColors.brand : AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Text('Tôi là:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.text2)),
              const SizedBox(width: 8),
              Expanded(
                child: SegmentedButton<String>(
                  showSelectedIcon: false,
                  style: SegmentedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    textStyle: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                  ),
                  segments: _groups.entries.map((e) => ButtonSegment(value: e.key, label: Text(e.value))).toList(),
                  selected: {_group},
                  onSelectionChanged: (s) {
                    setState(() => _group = s.first);
                    _persist();
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _welcome() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
      children: [
        Center(
          child: Container(
            width: 84,
            height: 84,
            decoration: BoxDecoration(
              gradient: AppColors.brandGradient,
              borderRadius: BorderRadius.circular(26),
              boxShadow: const [BoxShadow(color: Color(0x550284C7), blurRadius: 22, offset: Offset(0, 10))],
            ),
            child: const Icon(Icons.smart_toy_outlined, color: Colors.white, size: 42),
          ),
        ),
        const SizedBox(height: 16),
        const Text('Xin chào! Tôi là Trợ lý AI AirHCM', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        const SizedBox(height: 6),
        const Text(
          'Tôi trả lời dựa trên số liệu quan trắc thời gian thực, dự báo AI 24 giờ theo phường của bạn '
          'và cảnh báo QCVN 05:2023 của hệ thống WebGIS.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, color: AppColors.muted, height: 1.45),
        ),
        const SizedBox(height: 20),
        ..._suggestions.map((s) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  side: const BorderSide(color: AppColors.line),
                ),
                onPressed: () => _send(s),
                child: Row(children: [
                  const Icon(Icons.auto_awesome, size: 16, color: AppColors.brand),
                  const SizedBox(width: 10),
                  Expanded(child: Text(s, style: const TextStyle(color: AppColors.text, fontSize: 13.5))),
                ]),
              ),
            )),
      ],
    );
  }

  Widget _suggestionBar() {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        itemCount: _suggestions.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (_, i) => ActionChip(
          label: Text(_suggestions[i], style: const TextStyle(fontSize: 12)),
          avatar: const Icon(Icons.auto_awesome, size: 14),
          onPressed: () => _send(_suggestions[i]),
        ),
      ),
    );
  }

  Widget _typing() {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: AppColors.line)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Lottie.asset('assets/animations/ai_loading.json', width: 64, height: 40),
          const Padding(
            padding: EdgeInsets.only(right: 10),
            child: Text('Đang phân tích dữ liệu AQI...', style: TextStyle(fontSize: 12, color: AppColors.muted)),
          ),
        ]),
      ),
    );
  }

  Widget _bubble(_ChatMessage m) {
    final isUser = m.role == 'user';
    final time = '${m.time.hour.toString().padLeft(2, '0')}:${m.time.minute.toString().padLeft(2, '0')}';

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.84),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
          decoration: BoxDecoration(
            gradient: isUser ? AppColors.brandGradient : null,
            color: isUser ? null : Colors.white,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(18),
              topRight: const Radius.circular(18),
              bottomLeft: Radius.circular(isUser ? 18 : 4),
              bottomRight: Radius.circular(isUser ? 4 : 18),
            ),
            border: isUser ? null : Border.all(color: AppColors.line),
            boxShadow: const [BoxShadow(color: Color(0x0F0F172A), blurRadius: 8, offset: Offset(0, 3))],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (isUser)
                Text(m.text, style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.4))
              else
                MarkdownBody(
                  data: m.text,
                  styleSheet: MarkdownStyleSheet(
                    p: const TextStyle(fontSize: 13.8, height: 1.5, color: AppColors.text),
                    strong: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.text),
                  ),
                ),
              if (!isUser && m.sources.isNotEmpty) ...[
                const SizedBox(height: 8),
                const Row(
                  children: [
                    Icon(Icons.menu_book_outlined, size: 13, color: AppColors.muted),
                    SizedBox(width: 4),
                    Text('NGUỒN THAM KHẢO',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: AppColors.muted)),
                  ],
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 5,
                  runSpacing: 5,
                  children: m.sources
                      .map((s) => Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(color: const Color(0xFFEDE9FE), borderRadius: BorderRadius.circular(8)),
                            child: Text(s, style: const TextStyle(fontSize: 11, color: Color(0xFF5B21B6), height: 1.3)),
                          ))
                      .toList(),
                ),
              ],
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!isUser && m.source != null && m.source != 'error') ...[
                    Icon(m.source == 'gemini' ? Icons.auto_awesome : Icons.rule, size: 12, color: AppColors.muted),
                    const SizedBox(width: 3),
                    Text(
                      m.source == 'gemini' ? 'Gemini AI' : 'Bộ luật DSS',
                      style: const TextStyle(fontSize: 10.5, color: AppColors.muted, fontWeight: FontWeight.w700),
                    ),
                    if (m.ward != null) Text(' · ${m.ward}', style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
                    const SizedBox(width: 6),
                  ],
                  Text(time, style: TextStyle(fontSize: 10.5, color: isUser ? Colors.white70 : AppColors.muted)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _inputBar() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
        decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: AppColors.line))),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                enabled: !_loading,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: InputDecoration(
                  hintText: _loading ? 'AI đang phân tích dữ liệu...' : 'Hỏi về sức khỏe, khung giờ ra ngoài...',
                  filled: true,
                  fillColor: AppColors.surface2,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              decoration: BoxDecoration(gradient: _loading ? null : AppColors.brandGradient, color: _loading ? AppColors.line : null, shape: BoxShape.circle),
              child: IconButton(
                onPressed: _loading ? null : () => _send(),
                icon: const Icon(Icons.send_rounded, color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
