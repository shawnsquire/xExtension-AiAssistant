"use strict";

(function () {
	var EXT_NAME = "AI Assistant";

	function getAjaxUrl(action) {
		var url = new URL(window.location.pathname, window.location.origin);
		url.searchParams.set("c", "extension");
		url.searchParams.set("a", "configure");
		url.searchParams.set("e", EXT_NAME);
		url.searchParams.set("ajax_action", action);
		return url.toString();
	}

	function ajaxPost(action, params) {
		params._csrf = context.csrf;
		params.ajax = true;
		return fetch(getAjaxUrl(action), {
			method: "POST",
			headers: { "Content-Type": "application/json; charset=UTF-8" },
			body: JSON.stringify(params),
		}).then(function (r) { return r.json(); });
	}

	// ── Batch scoring ────────────────────────────────────────────────────────

	function scorePendingEntries() {
		var pending = document.querySelectorAll(".ai-score-pending");
		if (!pending.length) return;

		var ids = [];
		pending.forEach(function (el) {
			var id = el.dataset.entryId;
			if (id) ids.push(id);
		});
		if (!ids.length) return;

		// Show loading state
		pending.forEach(function (el) {
			el.innerHTML = '<span class="ai-scoring-spinner">Scoring\u2026</span>';
		});

		ajaxPost("score_batch", { entry_ids: ids })
			.then(function (data) {
				if (data.status !== "ok" || !data.scores) {
					console.error("AI scoring failed:", data.message);
					pending.forEach(function (el) {
						el.innerHTML = '<span class="ai-score-error">Score failed</span>'
							+ ' <button class="ai-retry-score-btn">Retry</button>';
					});
					return;
				}

				var scoreMap = {};
				data.scores.forEach(function (s) {
					scoreMap[s.id] = s;
				});

				pending.forEach(function (el) {
					var id = el.dataset.entryId;
					var s = scoreMap[id];
					if (!s) {
						el.innerHTML = "";
						return;
					}

					var colorClass = s.score >= 7 ? "ai-score-high"
						: s.score >= 4 ? "ai-score-mid" : "ai-score-low";

					var html = '<span class="ai-score-badge ' + colorClass
						+ '" title="' + (s.reason || "").replace(/"/g, "&quot;") + '">'
						+ s.score + "</span>";

					if (s.summary) {
						html += '<span class="ai-summary">'
							+ s.summary.replace(/</g, "&lt;").replace(/>/g, "&gt;")
							+ "</span>";
					} else {
						html += '<button class="ai-summarize-btn">Summarize</button>';
					}

					html += '<button class="ai-feedback-btn" data-dir="more" title="More like this">+</button>'
						+ '<button class="ai-feedback-btn" data-dir="less" title="Less like this">&minus;</button>';

					el.innerHTML = html;
					el.classList.remove("ai-score-pending");
				});
			})
			.catch(function (err) {
				console.error("AI scoring request failed:", err);
				pending.forEach(function (el) {
					el.innerHTML = '<span class="ai-score-error">Score failed</span>'
						+ ' <button class="ai-retry-score-btn">Retry</button>';
				});
			});
	}

	// ── Summarize ────────────────────────────────────────────────────────────

	function handleSummarize(btn) {
		var container = btn.closest(".ai-assistant-container");
		var entryId = container.dataset.entryId;

		btn.disabled = true;
		btn.textContent = "Summarizing\u2026";

		ajaxPost("summarize", { entry_id: entryId })
			.then(function (data) {
				if (data.status === "ok" && data.summary) {
					var span = document.createElement("span");
					span.className = "ai-summary";
					span.textContent = data.summary;
					btn.replaceWith(span);
				} else {
					btn.textContent = "Failed";
					btn.disabled = false;
				}
			})
			.catch(function () {
				btn.textContent = "Failed";
				btn.disabled = false;
			});
	}

	// ── Feedback ─────────────────────────────────────────────────────────────

	function handleFeedback(btn) {
		var container = btn.closest(".ai-assistant-container");
		var entryId = container.dataset.entryId;
		var direction = btn.dataset.dir;

		var reason = prompt(
			direction === "more"
				? "Why should articles like this score higher?"
				: "Why should articles like this score lower?"
		);
		if (reason === null) return;

		btn.disabled = true;

		ajaxPost("feedback", { entry_id: entryId, direction: direction, reason: reason })
			.then(function (data) {
				if (data.status === "ok") {
					btn.textContent = "\u2713";
					btn.classList.add("confirmed");
				} else {
					btn.disabled = false;
				}
			})
			.catch(function () {
				btn.disabled = false;
			});
	}

	// ── Event delegation ─────────────────────────────────────────────────────

	document.addEventListener("DOMContentLoaded", function () {
		scorePendingEntries();

		document.addEventListener("click", function (e) {
			var retryBtn = e.target.closest(".ai-retry-score-btn");
			if (retryBtn) {
				var container = retryBtn.closest(".ai-assistant-container");
				container.classList.add("ai-score-pending");
				container.innerHTML = "";
				scorePendingEntries();
				return;
			}

			var summarizeBtn = e.target.closest(".ai-summarize-btn");
			if (summarizeBtn) {
				handleSummarize(summarizeBtn);
				return;
			}

			var feedbackBtn = e.target.closest(".ai-feedback-btn");
			if (feedbackBtn) {
				handleFeedback(feedbackBtn);
				return;
			}
		});
	});
})();
