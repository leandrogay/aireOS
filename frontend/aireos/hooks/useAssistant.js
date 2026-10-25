'use client';

import { useCallback, useState } from 'react';

/**
 * Drives the floating AI assistant widget (see AssistantWidget.jsx).
 *
 * Multi-turn memory is client-held: `history` is the raw Anthropic message
 * list the backend returned last turn (see assistant.ask()'s `messages`
 * field) and gets sent back verbatim on the next question, exactly like the
 * Messages API itself expects (it's stateless -- the full history goes in
 * every request). `messages` is the separate UI-facing list this hook
 * builds for rendering (role + text + chart/table + follow-ups), not what
 * gets sent to the backend.
 *
 * No persistence beyond this hook's own state -- a full page reload starts
 * a fresh conversation. The widget itself is mounted in app/layout.js (not
 * a page), so this state survives client-side navigation between pages.
 */
// Shared by askQuestion and askDigest -- both endpoints return the same
// response shape (see assistant.ask()/generate_digest() in the backend),
// so both build the same UI-facing message object from it.
function assistantMessageFromResponse(data) {
  return {
    role: 'assistant',
    text: data.answer,
    // What a PDF/PowerPoint says: the original answer when this message only restyled a chart.
    exportText: data.export_answer || data.answer,
    grounded: data.grounded,
    dataSource: data.data_source,
    hasChart: data.has_chart,
    chartType: data.chart_type,
    chartCategories: data.chart_categories,
    chartSeries: data.chart_series,
    hasTable: data.has_table,
    tableColumns: data.table_columns,
    tableRows: data.table_rows,
    // What the table's figures are as of (the forecast table's run time); '' otherwise.
    tableNote: data.table_note || '',
    followUpPrompts: data.follow_up_prompts || [],
    hasDownload: data.has_download,
    downloadFilename: data.download_filename,
    downloadMimeType: data.download_mime_type,
    downloadBase64: data.download_base64,
    chartStyle: data.chart_style,
    chartTrendValues: data.chart_trend_values || [],
  };
}

export default function useAssistant() {
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const askQuestion = useCallback(
    async (question) => {
      const trimmed = question?.trim();
      if (!trimmed || loading) return;

      setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
      setLoading(true);
      setError(null);

      // "The chart on screen" is the chart of the latest reply that was about
      // data. A question that failed has no reply, and chit-chat ("thanks")
      // or a refusal has no chart and no data of its own, so those are skipped
      // rather than hiding the chart still on screen; a reply that answered a
      // data question (even without a table) stops the search, so an older
      // question's chart never ends up next to a newer answer. The style is a
      // separate preference that persists, so it still comes from the latest
      // message with a chart.
      const previousMessage = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && (m.hasChart || m.hasTable || m.dataSource !== 'none'));
      const previousHasData = previousMessage && (previousMessage.hasChart || previousMessage.hasTable);
      const lastChart = previousHasData
        ? {
            has_chart: previousMessage.hasChart,
            chart_type: previousMessage.chartType,
            chart_categories: previousMessage.chartCategories,
            chart_series: previousMessage.chartSeries,
            has_table: previousMessage.hasTable,
            table_columns: previousMessage.tableColumns,
            table_rows: previousMessage.tableRows,
            table_note: previousMessage.tableNote,
          }
        : {};
      const lastChartMessage = [...messages].reverse().find((m) => m.hasChart || m.hasTable);
      const lastChartStyle = lastChartMessage?.chartStyle || {};

      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assistant/ask`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: trimmed,
            history,
            last_chart: lastChart,
            last_chart_style: lastChartStyle,
            last_answer: previousHasData ? previousMessage.exportText || previousMessage.text : '',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to get an answer');

        setHistory(data.messages || []);
        setMessages((prev) => [...prev, assistantMessageFromResponse(data)]);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [history, loading, messages]
  );

  // Deterministic "what's changed" summary -- unlike askQuestion, there's no
  // user question to show, and it always starts a fresh conversation (it
  // doesn't take `history`, matching generate_digest()'s signature backend-side).
  const askDigest = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assistant/digest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to get the digest');

      setHistory(data.messages || []);
      setMessages((prev) => [...prev, assistantMessageFromResponse(data)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  return { messages, askQuestion, askDigest, loading, error };
}
