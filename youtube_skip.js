// 유튜브 광고 차단 v6 (MAIN world, document_start 에서 실행)
//
// 핵심 전략(예방형): 유튜브 플레이어 응답(JSON)에서 광고 데이터를 로드 전에
//   제거해 광고가 애초에 편성되지 않게 한다. 광고가 없으니 "N개 재생 후 차단"
//   감지도 트리거되지 않는다. (uBlock Origin 계열과 같은 원리)
//
// v5 → v6 버그 수정:
//   1) v5의 "스킵 안전망"이 광고가 아니라 본영상의 currentTime 을 끝으로
//      밀어버려, 믹스/재생목록에서 본영상까지 통째로 스킵 → 다음 영상 →
//      또 스킵… 무한 루프가 발생했다.
//      → 시간 점프/강제 재로드 로직을 완전히 제거. 광고는 오직 "응답 제거"로만
//        막고, 실제로 보이는 '광고 건너뛰기' 버튼만 안전하게 눌러준다.
//   2) 감지 팝업 제거 선택자가 너무 넓어(tp-yt-paper-dialog 등) 유튜브의
//      일반 메뉴/대화상자까지 지우고 매 프레임 로그를 뿜었다.
//      → 광고차단 경고 전용 요소(ytd-enforcement-message-view-model)가
//        실제로 있을 때만 그 대화상자를 닫는다.

(() => {
  const TAG = "[my-adblock]";
  console.log(TAG, "youtube adblock v6 로드됨");

  // 플레이어 응답에서 삭제할 광고 관련 최상위 키
  const AD_KEYS = [
    "adPlacements",
    "adSlots",
    "playerAds",
    "adBreakHeartbeatParams",
  ];

  function stripPlayerResponse(pr) {
    if (!pr || typeof pr !== "object") return pr;
    try {
      for (const k of AD_KEYS) {
        if (k in pr) delete pr[k];
      }
      if (pr.playerConfig && pr.playerConfig.daiConfig) {
        delete pr.playerConfig.daiConfig; // 서버 삽입 광고(DAI) 설정 제거
      }
    } catch (e) {}
    return pr;
  }

  function looksLikePlayerResponse(o) {
    return (
      o &&
      typeof o === "object" &&
      (o.adPlacements || o.playerAds || o.adSlots)
    );
  }

  // ---- 1) ytInitialPlayerResponse 가로채기 (최초 페이지 로드용) ----
  try {
    let _ipr = window.ytInitialPlayerResponse;
    if (_ipr) _ipr = stripPlayerResponse(_ipr);
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get() {
        return _ipr;
      },
      set(v) {
        _ipr = stripPlayerResponse(v);
      },
    });
  } catch (e) {}

  // ---- 2) fetch 후킹 (다른 영상 클릭 등 SPA 이동용) ----
  try {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const arg0 = args[0];
      const url =
        typeof arg0 === "string" ? arg0 : (arg0 && arg0.url) || "";
      const res = await origFetch.apply(this, args);
      try {
        if (
          url.includes("/youtubei/v1/player") ||
          url.includes("/youtubei/v1/next")
        ) {
          const text = await res.clone().text();
          const data = JSON.parse(text);
          stripPlayerResponse(data);
          if (data && data.playerResponse) {
            stripPlayerResponse(data.playerResponse);
          }
          return new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      } catch (e) {}
      return res;
    };
  } catch (e) {}

  // ---- 3) JSON.parse 후킹 (보조 그물) ----
  try {
    const origParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const data = origParse.call(this, text, reviver);
      try {
        if (looksLikePlayerResponse(data)) stripPlayerResponse(data);
      } catch (e) {}
      return data;
    };
  } catch (e) {}

  // ---- 4) 광고차단 감지 경고 대화상자만 정확히 닫기 ----
  // 유튜브의 "광고 차단 프로그램 사용 중" 경고는 ytd-enforcement-message-view-model
  // 요소로 뜬다. 이 요소가 실제로 있을 때만 해당 대화상자와 배경을 제거한다.
  function removeEnforcement() {
    const msg = document.querySelector("ytd-enforcement-message-view-model");
    if (!msg) return; // 경고가 없으면 아무것도 건드리지 않음 (일반 메뉴 보호)

    const dialog =
      msg.closest("tp-yt-paper-dialog") ||
      msg.closest("ytd-popup-container") ||
      msg;
    try {
      dialog.remove();
    } catch (e) {}
    document
      .querySelectorAll("tp-yt-iron-overlay-backdrop")
      .forEach((n) => n.remove());
    document.documentElement.style.overflow = ""; // 스크롤 잠금 해제

    // 경고가 영상을 멈췄다면 다시 재생 (본영상 시간은 절대 건드리지 않음)
    const v = document.querySelector(
      "#movie_player video, video.html5-main-video"
    );
    if (v && v.paused) v.play().catch(() => {});
    console.log(TAG, "광고차단 감지 경고 제거함");
  }

  // ---- 5) 혹시 새어 나온 광고: '건너뛰기' 버튼만 안전하게 클릭 ----
  // (본영상 시간을 조작하지 않으므로 본영상이 스킵될 위험이 없다)
  const SKIP_BUTTON_SELECTORS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button",
  ];

  function clickVisibleSkipButtons() {
    for (const sel of SKIP_BUTTON_SELECTORS) {
      document.querySelectorAll(sel).forEach((btn) => {
        if (btn && btn.offsetParent !== null) {
          try {
            btn.click();
          } catch (e) {}
        }
      });
    }
  }

  setInterval(() => {
    removeEnforcement();
    clickVisibleSkipButtons();
  }, 500);
})();
