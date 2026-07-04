// 유튜브 광고 자동 스킵 v4 (MAIN world에서 실행)
// v3까지의 한계: 유튜브가 스크립트발 가짜 클릭(isTrusted=false)을 무시하는
// 방어를 쓰면 건너뛰기 버튼 클릭이 통하지 않았다 (믹스 재생목록의 정지화면 광고).
// v4 대응:
//  1) 실제 마우스처럼 pointerdown→mousedown→pointerup→mouseup→click 순서로 이벤트 발생
//  2) 영상 광고는 길이 정보 도착 즉시 끝으로 점프 (기존 유지)
//  3) 최후 수단: 광고가 2초 넘게 버티면 플레이어 내부 API로 본편을
//     현재 위치에서 다시 로드 (광고 세션 자체를 날려버림, 재생목록 유지)

(() => {
  console.log("[my-adblock] youtube_skip v4 로드됨");

  const SKIP_BUTTON_SELECTORS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button",
    ".ytp-ad-overlay-close-button",
  ];

  const FORCE_RELOAD_AFTER_MS = 2000; // 이 시간 넘게 광고가 버티면 강제 재로드

  let adWasShowing = false;
  let adStartedAt = 0;
  let reloadedThisAd = false;
  const hookedVideos = new WeakSet();

  function getPlayer() {
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  function adIsShowing(player) {
    return (
      !!player &&
      (player.classList.contains("ad-showing") ||
        player.classList.contains("ad-interrupting"))
    );
  }

  // 실제 마우스 조작처럼 보이도록 이벤트를 순서대로 발생
  function realClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  function clickSkipButtons() {
    for (const sel of SKIP_BUTTON_SELECTORS) {
      document.querySelectorAll(sel).forEach(realClick);
    }
  }

  function jumpToEnd(video) {
    if (isFinite(video.duration) && video.duration > 0.5) {
      video.currentTime = video.duration;
      return true;
    }
    return false;
  }

  function hookVideo(video) {
    if (hookedVideos.has(video)) return;
    hookedVideos.add(video);
    video.addEventListener("durationchange", () => {
      if (adIsShowing(getPlayer())) jumpToEnd(video);
    });
  }

  // 최후 수단: 본편을 현재 위치에서 광고 없이 다시 로드
  // (MAIN world라서 유튜브 플레이어 내부 API에 접근 가능)
  function forceReload(player) {
    try {
      const data = player.getVideoData && player.getVideoData();
      if (!data || !data.video_id) return;
      const t = player.getCurrentTime ? player.getCurrentTime() : 0;
      const listId = player.getPlaylistId && player.getPlaylistId();

      if (listId && typeof player.loadPlaylist === "function") {
        // 믹스/재생목록을 유지한 채 현재 곡을 다시 로드
        const idx = player.getPlaylistIndex ? player.getPlaylistIndex() : 0;
        player.loadPlaylist({
          listType: "playlist",
          list: listId,
          index: idx,
          startSeconds: t,
        });
      } else if (typeof player.loadVideoById === "function") {
        player.loadVideoById(data.video_id, t);
      }
      console.log("[my-adblock] 광고가 버텨서 본편을 강제 재로드함");
    } catch (e) {
      // 내부 API가 바뀌었을 수 있음 — 조용히 포기 (다른 수단은 계속 동작)
    }
  }

  function trySkip() {
    clickSkipButtons();

    const player = getPlayer();
    if (!player) return;
    const video = player.querySelector("video");

    if (adIsShowing(player)) {
      if (!adWasShowing) {
        adWasShowing = true;
        adStartedAt = Date.now();
        reloadedThisAd = false;
      }
      if (video) {
        hookVideo(video);
        video.muted = true;
        if (!jumpToEnd(video)) {
          video.playbackRate = 16;
        }
      }
      // 클릭도 점프도 안 통하고 버티는 광고 → 강제 재로드 (광고당 1회만)
      if (!reloadedThisAd && Date.now() - adStartedAt > FORCE_RELOAD_AFTER_MS) {
        reloadedThisAd = true;
        forceReload(player);
      }
    } else if (adWasShowing) {
      adWasShowing = false;
      if (video) {
        video.muted = false;
        video.playbackRate = 1;
      }
    }
  }

  const observer = new MutationObserver(trySkip);
  let observedPlayer = null;

  function watchPlayer() {
    const player = getPlayer();
    if (player && player !== observedPlayer) {
      observer.observe(player, { attributes: true, attributeFilter: ["class"] });
      observedPlayer = player;
    }
  }

  watchPlayer();
  setInterval(() => {
    watchPlayer();
    trySkip();
  }, 200);
})();
