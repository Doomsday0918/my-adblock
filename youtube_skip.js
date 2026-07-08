// 유튜브 광고 차단 v5 (MAIN world, document_start 에서 실행)
//
// 전략 변경 (중요):
//   v4까지는 "광고를 일단 재생시킨 뒤 스킵/점프"하는 반응형이었다.
//   그런데 유튜브는 '광고가 편성됐는데 제대로 안 나왔다'는 정황으로
//   광고 차단을 감지해 "동영상 N개 재생 후 차단됩니다" 팝업을 띄운다.
//   즉 광고를 늦게 없앨수록 오히려 감지에 걸린다.
//
//   v5는 접근을 뒤집는다. 유튜브 플레이어가 광고를 편성하기 "전에",
//   서버가 내려주는 플레이어 응답(JSON)에서 광고 데이터를 통째로 지운다.
//   광고가 애초에 편성되지 않으므로 감지할 대상이 없고, 경고 팝업도 안 뜬다.
//   (uBlock Origin 계열이 쓰는 방식과 동일한 원리)
//
// 구성:
//   1) ytInitialPlayerResponse (최초 로드 시 광고 데이터) 가로채 제거
//   2) fetch 후킹 — /youtubei/v1/player·/next 응답에서 광고 데이터 제거
//   3) JSON.parse 후킹 — 광고 키가 든 응답이면 마저 제거 (보조)
//   4) 그래도 감지 팝업/오버레이가 뜨면 DOM에서 제거하고 재생 재개
//   5) 최후 안전망 — 혹시 남은 광고는 기존처럼 스킵 버튼 클릭/끝으로 점프

(() => {
  const TAG = "[my-adblock]";
  console.log(TAG, "youtube adblock v5 로드됨");

  // 플레이어 응답에서 삭제할 광고 관련 최상위 키
  const AD_KEYS = [
    "adPlacements",
    "adSlots",
    "playerAds",
    "adBreakHeartbeatParams",
  ];

  // 플레이어 응답 객체에서 광고 데이터를 제거한다.
  function stripPlayerResponse(pr) {
    if (!pr || typeof pr !== "object") return pr;
    try {
      for (const k of AD_KEYS) {
        if (k in pr) delete pr[k];
      }
      // 서버 삽입 광고(DAI) 설정도 있으면 제거
      if (pr.playerConfig && pr.playerConfig.daiConfig) {
        delete pr.playerConfig.daiConfig;
      }
    } catch (e) {}
    return pr;
  }

  // 광고 키가 들어 있는 응답인지 빠르게 판별
  function looksLikePlayerResponse(o) {
    return (
      o &&
      typeof o === "object" &&
      (o.adPlacements || o.playerAds || o.adSlots)
    );
  }

  // ---- 1) ytInitialPlayerResponse 가로채기 ----
  // 유튜브가 인라인 스크립트로 이 전역변수에 광고 데이터를 넣기 "전에"
  // getter/setter 를 걸어 값이 들어오는 순간 광고를 제거한다.
  try {
    let _ipr = window.ytInitialPlayerResponse;
    if (_ipr) _ipr = stripPlayerResponse(_ipr); // 이미 있으면 즉시 정리
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

  // ---- 2) fetch 후킹 ----
  // SPA 이동(다른 영상 클릭 등) 시 광고 데이터는 이 API로 새로 내려온다.
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
          // next 응답 등 내부에 중첩된 playerResponse 도 정리
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

  // ---- 4) 감지 팝업 / 오버레이 제거 + 재생 재개 ----
  const ENFORCEMENT_SELECTORS = [
    "ytd-enforcement-message-view-model",
    "ytd-popup-container tp-yt-paper-dialog",
    "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
  ];

  function getPlayer() {
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  function removeEnforcementPopups() {
    let removed = false;
    for (const sel of ENFORCEMENT_SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue; // :has 등 미지원 브라우저는 건너뜀
      }
      nodes.forEach((n) => {
        n.remove();
        removed = true;
      });
    }
    // 팝업이 깔아놓은 어두운 배경 제거 + 스크롤 잠금 해제
    document
      .querySelectorAll("tp-yt-iron-overlay-backdrop")
      .forEach((n) => n.remove());
    if (removed) {
      document.documentElement.style.overflow = "";
      const player = getPlayer();
      const video = player && player.querySelector("video");
      if (video && video.paused) {
        video.play().catch(() => {});
      }
      console.log(TAG, "광고차단 감지 팝업 제거함");
    }
  }

  // ---- 5) 최후 안전망: 그래도 광고가 뜨면 스킵 ----
  const SKIP_BUTTON_SELECTORS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button",
    ".ytp-ad-overlay-close-button",
  ];

  function realClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  function adIsShowing(player) {
    return (
      !!player &&
      (player.classList.contains("ad-showing") ||
        player.classList.contains("ad-interrupting"))
    );
  }

  function skipFallback() {
    const player = getPlayer();
    if (!adIsShowing(player)) return;
    for (const sel of SKIP_BUTTON_SELECTORS) {
      document.querySelectorAll(sel).forEach(realClick);
    }
    const video = player.querySelector("video");
    if (video && isFinite(video.duration) && video.duration > 0.5) {
      video.muted = true;
      video.currentTime = video.duration; // 광고 끝으로 점프
    }
  }

  // 팝업 제거와 안전망 스킵을 주기적으로 수행
  setInterval(() => {
    removeEnforcementPopups();
    skipFallback();
  }, 300);
})();
