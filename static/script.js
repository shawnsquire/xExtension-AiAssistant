"use strict";

(function () {
	var EXT_NAME = "AI Assistant";
	var CHUNK_SIZE = 10;

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

	// ── Chunked batch scoring ───────────────────────────────────────────────

	function scorePendingEntries() {
		var pending = document.querySelectorAll(".ai-score-pending");
		if (!pending.length) return;

		var ids = [];
		var elMap = {};
		pending.forEach(function (el) {
			var id = el.dataset.entryId;
			if (id) {
				ids.push(id);
				elMap[id] = el;
			}
		});
		if (!ids.length) return;

		// Show loading state on all
		pending.forEach(function (el) {
			el.innerHTML = '<span class="ai-scoring-spinner">Scoring\u2026</span>';
		});

		// 1 entry → score immediately; multiple → chunk into groups of CHUNK_SIZE
		var chunks = [];
		for (var i = 0; i < ids.length; i += CHUNK_SIZE) {
			chunks.push(ids.slice(i, i + CHUNK_SIZE));
		}

		// Process chunks sequentially
		function processChunk(index) {
			if (index >= chunks.length) return;

			var chunk = chunks[index];
			ajaxPost("score_batch", { entry_ids: chunk })
				.then(function (data) {
					if (data.status !== "ok" || !data.scores) {
						console.error("AI scoring failed:", data.message);
						chunk.forEach(function (id) {
							if (elMap[id]) {
								elMap[id].innerHTML = '<span class="ai-score-error">Score failed</span>'
									+ ' <button class="ai-retry-score-btn">Retry</button>';
							}
						});
					} else {
						data.scores.forEach(function (s) {
							var el = elMap[s.id];
							if (!el) return;
							renderScore(el, s);
						});
					}
					processChunk(index + 1);
				})
				.catch(function (err) {
					console.error("AI scoring request failed:", err);
					chunk.forEach(function (id) {
						if (elMap[id]) {
							elMap[id].innerHTML = '<span class="ai-score-error">Score failed</span>'
								+ ' <button class="ai-retry-score-btn">Retry</button>';
						}
					});
					processChunk(index + 1);
				});
		}

		processChunk(0);
	}

	function renderScore(el, s) {
		var colorClass = s.score >= 7 ? "ai-score-high"
			: s.score >= 4 ? "ai-score-mid" : "ai-score-low";

		var html = '<span class="ai-score-badge ' + colorClass
			+ '" title="' + (s.reason || "").replace(/"/g, "&quot;") + '">'
			+ s.score + "</span>";

		if (s.summary) {
			html += '<span class="ai-summary">'
				+ escapeHtml(s.summary) + "</span>";
			html += '<button class="ai-detail-btn">More detail</button>';
		} else {
			html += '<button class="ai-summarize-btn">Summarize</button>';
		}

		html += '<button class="ai-feedback-btn" data-dir="more" title="More like this">+</button>'
			+ '<button class="ai-feedback-btn" data-dir="less" title="Less like this">&minus;</button>';

		el.innerHTML = html;
		el.classList.remove("ai-score-pending");
	}

	function escapeHtml(str) {
		return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
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
					var detailBtn = document.createElement("button");
					detailBtn.className = "ai-detail-btn";
					detailBtn.textContent = "More detail";
					btn.replaceWith(span);
					// Insert detail button after the summary span
					span.after(detailBtn);
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

	// ── Detail ──────────────────────────────────────────────────────────────

	function handleDetail(btn) {
		var container = btn.closest(".ai-assistant-container");
		var entryId = container.dataset.entryId;

		btn.disabled = true;
		btn.textContent = "Loading\u2026";

		ajaxPost("detail", { entry_id: entryId })
			.then(function (data) {
				if (data.status === "ok" && data.detail) {
					var detailDiv = document.createElement("div");
					detailDiv.className = "ai-detail";
					detailDiv.innerHTML = formatDetail(data.detail);
					// Insert after the container's inline content (as last child, before closing)
					container.appendChild(detailDiv);

					// Replace button with toggle
					btn.textContent = "Hide detail";
					btn.disabled = false;
					btn.className = "ai-detail-toggle";
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

	function handleDetailToggle(btn) {
		var container = btn.closest(".ai-assistant-container");
		var detailDiv = container.querySelector(".ai-detail");
		if (!detailDiv) return;

		if (detailDiv.style.display === "none") {
			detailDiv.style.display = "";
			btn.textContent = "Hide detail";
		} else {
			detailDiv.style.display = "none";
			btn.textContent = "More detail";
		}
	}

	function formatDetail(text) {
		// Escape HTML
		var escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		// Convert **Title** to <strong>Title</strong>
		escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
		// Convert newlines to <br>
		return escaped.replace(/\n/g, "<br>");
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

			var detailBtn = e.target.closest(".ai-detail-btn");
			if (detailBtn) {
				handleDetail(detailBtn);
				return;
			}

			var toggleBtn = e.target.closest(".ai-detail-toggle");
			if (toggleBtn) {
				handleDetailToggle(toggleBtn);
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
