(function () {
  var state = {
    settings: {},
    videos: [],
    activeCategory: "All",
    searchText: "",
    shuffledCategories: [],
    shuffledAllVideos: [],
    currentVideo: null,
    sheetOpen: false,
    loaderTimer: null,
    youtubeLoadTimer: null,
    youtubeLoadToken: 0,
    youtubeFrameLoaded: false,
    seeking: false,
    wasPlayingBeforeSeek: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function request(method, url, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        callback(null, JSON.parse(xhr.responseText || "{}"));
      } else {
        callback(new Error("Request failed"));
      }
    };
    xhr.send(data ? JSON.stringify(data) : null);
  }

  function thumb(video) {
    if (video.thumbnailUrl) return video.thumbnailUrl;
    if (video.sourceType === "mp4") return "";
    return "https://img.youtube.com/vi/" + encodeURIComponent(video.youtubeId) + "/hqdefault.jpg";
  }

  function shuffleCopy(items) {
    var copy = items.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function enabledVideos() {
    return state.videos.filter(function (video) {
      return video.enabled;
    });
  }

  function categories() {
    var seen = { All: true };
    var list = ["All"];
    enabledVideos().forEach(function (video) {
      if (!seen[video.category]) {
        seen[video.category] = true;
        list.push(video.category);
      }
    });
    return list;
  }

  function shuffleAllVideos() {
    state.shuffledAllVideos = shuffleCopy(enabledVideos());
  }

  function setActiveCategory(category) {
    state.activeCategory = category;
    if (category === "All") shuffleAllVideos();
    updateTabState();
    renderGrid();
  }

  function filteredVideos() {
    var query = state.searchText.toLowerCase();
    var source = state.activeCategory === "All" ? state.shuffledAllVideos : enabledVideos();
    return source.filter(function (video) {
      var inCategory = state.activeCategory === "All" || video.category === state.activeCategory;
      var inSearch = !query || video.title.toLowerCase().indexOf(query) !== -1 || video.category.toLowerCase().indexOf(query) !== -1;
      return inCategory && inSearch;
    });
  }

  function makeVideoButton(video, small) {
    var button = document.createElement("button");
    button.className = "video-card";
    button.type = "button";
    button.setAttribute("aria-label", "Play " + video.title);

    var imgSrc = thumb(video);
    var img;
    if (imgSrc) {
      img = document.createElement("img");
      img.className = "thumb";
      img.src = imgSrc;
      img.alt = "";
    } else {
      img = document.createElement("div");
      img.className = "thumb thumb-fallback";
      img.appendChild(document.createTextNode("PLAY"));
    }

    var title = document.createElement("strong");
    title.appendChild(document.createTextNode(video.title));

    var category = document.createElement("span");
    category.appendChild(document.createTextNode(video.category));

    button.appendChild(img);
    button.appendChild(title);
    if (!small) button.appendChild(category);
    button.onclick = function () {
      play(video.id);
    };
    return button;
  }

  function renderTabs() {
    var tabs = $("categoryTabs");
    tabs.innerHTML = "";
    state.shuffledCategories.forEach(function (category) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "tab" + (category === state.activeCategory ? " active" : "");
      button.appendChild(document.createTextNode(category));
      button.onclick = function () {
        setActiveCategory(category);
      };
      tabs.appendChild(button);
    });
  }

  function updateTabState() {
    var tabs = $("categoryTabs").getElementsByTagName("button");
    for (var i = 0; i < tabs.length; i += 1) {
      var label = tabs[i].textContent || tabs[i].innerText;
      tabs[i].className = "tab" + (label === state.activeCategory ? " active" : "");
    }
  }

  function renderGrid() {
    var grid = $("videoGrid");
    var videos = filteredVideos();
    grid.innerHTML = "";
    $("emptyState").className = videos.length ? "empty hidden" : "empty";
    videos.forEach(function (video) {
      grid.appendChild(makeVideoButton(video, false));
    });
  }

  function renderRelated() {
    var list = $("relatedList");
    list.innerHTML = "";
    shuffleCopy(enabledVideos()).forEach(function (video) {
      if (!state.currentVideo || video.id !== state.currentVideo.id) {
        list.appendChild(makeVideoButton(video, true));
      }
    });
  }

  function render() {
    $("childName").innerHTML = "";
    $("childName").appendChild(document.createTextNode(state.settings.childName || "Nitzan"));
    $("childInitial").innerHTML = "";
    $("childInitial").appendChild(document.createTextNode((state.settings.childName || "Nitzan").charAt(0).toUpperCase()));
    state.shuffledCategories = ["All"].concat(shuffleCopy(categories().filter(function (category) {
      return category !== "All";
    })));
    shuffleAllVideos();
    renderTabs();
    renderGrid();
  }

  function showLoader() {
    if (state.loaderTimer) clearTimeout(state.loaderTimer);
    $("videoLoader").className = "video-loader";
    state.loaderTimer = setTimeout(hideLoader, 3500);
  }

  function hideLoader() {
    if (state.loaderTimer) {
      clearTimeout(state.loaderTimer);
      state.loaderTimer = null;
    }
    $("videoLoader").className = "video-loader hidden";
  }

  function youtubeEmbedUrl(video, autoplay, retry) {
    var url = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(video.youtubeId) + "?rel=0&modestbranding=1&playsinline=1&autoplay=" + autoplay + "&vq=medium";
    if (retry) url += "&reload=" + encodeURIComponent(String(retry));
    return url;
  }

  function clearYoutubeLoadRetry() {
    if (state.youtubeLoadTimer) {
      clearTimeout(state.youtubeLoadTimer);
      state.youtubeLoadTimer = null;
    }
  }

  function markYoutubeFrameLoaded() {
    if (!state.currentVideo || state.currentVideo.sourceType === "mp4") return;
    state.youtubeFrameLoaded = true;
    clearYoutubeLoadRetry();
    hideLoader();
  }

  function watchYoutubeFrameLoad(video, autoplay) {
    var token = state.youtubeLoadToken;
    clearYoutubeLoadRetry();
    state.youtubeFrameLoaded = false;
    state.youtubeLoadTimer = setTimeout(function () {
      if (token !== state.youtubeLoadToken) return;
      if (!state.currentVideo || state.currentVideo.id !== video.id) return;
      if (state.youtubeFrameLoaded) return;
      showLoader();
      $("player").src = youtubeEmbedUrl(video, autoplay, Date.now());
    }, 5000);
  }

  function tryPlayMp4() {
    var video = $("mp4Player");
    var playPromise = video.play();
    if (playPromise && playPromise.catch) playPromise.catch(function () {});
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var total = Math.floor(seconds);
    var mins = Math.floor(total / 60);
    var secs = total % 60;
    return mins + ":" + (secs < 10 ? "0" : "") + secs;
  }

  function updateSeekUi() {
    var video = $("mp4Player");
    var duration = video.duration || 0;
    var current = video.currentTime || 0;
    $("currentTimeLabel").innerHTML = formatTime(current);
    $("durationLabel").innerHTML = formatTime(duration);
    if (!state.seeking && duration > 0) {
      $("seekSlider").value = Math.floor((current / duration) * 1000);
    }
    $("playPauseButton").innerHTML = video.paused ? "Play" : "Pause";
  }

  function showMp4Controls(show) {
    $("mp4Controls").className = show ? "mp4-controls" : "mp4-controls hidden";
  }

  function play(id) {
    var found = state.videos.filter(function (video) {
      return video.id === id;
    })[0];
    if (!found) return;
    state.currentVideo = found;
    state.youtubeLoadToken += 1;
    clearYoutubeLoadRetry();
    state.youtubeFrameLoaded = false;
    $("homeView").className = "hidden";
    $("watchView").className = "watch-view";
    $("watchTitle").innerHTML = "";
    $("watchTitle").appendChild(document.createTextNode(found.title));
    var shouldAutoplay = state.settings.autoplay !== false;
    $("player").className = "hidden";
    $("mp4Player").pause();
    $("mp4Player").removeAttribute("src");
    $("mp4Player").autoplay = shouldAutoplay;
    $("mp4Player").preload = "auto";
    $("mp4Player").className = "hidden";
    showMp4Controls(false);
    if (found.sourceType === "mp4") {
      $("player").src = "about:blank";
      $("mp4Player").src = "/api/stream/" + encodeURIComponent(found.id);
      $("mp4Player").className = "";
      showMp4Controls(true);
      updateSeekUi();
      $("mp4Player").load();
      if (shouldAutoplay) tryPlayMp4();
    } else {
      showLoader();
      var autoplay = shouldAutoplay ? "1" : "0";
      $("player").src = youtubeEmbedUrl(found, autoplay, 0);
      $("player").className = "";
      watchYoutubeFrameLoad(found, autoplay);
    }
    state.sheetOpen = false;
    updateSheet();
    renderRelated();
  }

  function closePlayer() {
    hideLoader();
    state.youtubeLoadToken += 1;
    clearYoutubeLoadRetry();
    state.youtubeFrameLoaded = false;
    state.currentVideo = null;
    $("player").src = "about:blank";
    $("mp4Player").pause();
    $("mp4Player").removeAttribute("src");
    $("mp4Player").load();
    showMp4Controls(false);
    $("watchView").className = "watch-view hidden";
    $("homeView").className = "";
  }

  function updateSheet() {
    $("relatedSheet").className = "related-sheet" + (state.sheetOpen ? " open" : "");
  }

  function bindSheet() {
    var handle = $("sheetHandle");
    var startY = 0;
    var dragging = false;

    function getY(event) {
      if (event.touches && event.touches.length) return event.touches[0].clientY;
      return event.clientY;
    }

    function start(event) {
      dragging = true;
      startY = getY(event);
    }

    function move(event) {
      if (!dragging) return;
      var diff = getY(event) - startY;
      if (Math.abs(diff) > 36) {
        state.sheetOpen = diff < 0;
        updateSheet();
      }
      if (event.preventDefault) event.preventDefault();
    }

    function end() {
      dragging = false;
    }

    handle.onclick = function () {
      state.sheetOpen = !state.sheetOpen;
      updateSheet();
    };
    handle.addEventListener("touchstart", start, false);
    handle.addEventListener("touchmove", move, false);
    handle.addEventListener("touchend", end, false);
    handle.addEventListener("mousedown", start, false);
    document.addEventListener("mousemove", move, false);
    document.addEventListener("mouseup", end, false);
  }

  function init() {
    $("backButton").onclick = closePlayer;
    $("profileBadge").onclick = function (event) {
      if (event.preventDefault) event.preventDefault();
      setActiveCategory("All");
    };
    $("searchButton").onclick = function () {
      if ($("searchPanel").className.indexOf("hidden") !== -1) {
        $("searchPanel").className = "search-panel";
        $("searchInput").focus();
      } else {
        $("searchPanel").className = "search-panel hidden";
      }
    };
    $("searchInput").oninput = function () {
      state.searchText = $("searchInput").value || "";
      renderGrid();
    };
    $("clearSearchButton").onclick = function () {
      state.searchText = "";
      $("searchInput").value = "";
      renderGrid();
      $("searchInput").focus();
    };
    $("playPauseButton").onclick = function () {
      if ($("mp4Player").paused) tryPlayMp4();
      else $("mp4Player").pause();
      updateSeekUi();
    };
    $("seekSlider").addEventListener("touchstart", function () {
      state.seeking = true;
      state.wasPlayingBeforeSeek = !$("mp4Player").paused;
      $("mp4Player").pause();
    }, false);
    $("seekSlider").addEventListener("mousedown", function () {
      state.seeking = true;
      state.wasPlayingBeforeSeek = !$("mp4Player").paused;
      $("mp4Player").pause();
    }, false);
    $("seekSlider").addEventListener("input", function () {
      var video = $("mp4Player");
      var duration = video.duration || 0;
      if (duration > 0) {
        var nextTime = (parseInt($("seekSlider").value, 10) / 1000) * duration;
        $("currentTimeLabel").innerHTML = formatTime(nextTime);
      }
    }, false);
    $("seekSlider").addEventListener("change", function () {
      var video = $("mp4Player");
      var duration = video.duration || 0;
      if (duration > 0) video.currentTime = (parseInt($("seekSlider").value, 10) / 1000) * duration;
      state.seeking = false;
      if (state.wasPlayingBeforeSeek) tryPlayMp4();
      updateSeekUi();
    }, false);
    $("player").onload = markYoutubeFrameLoaded;
    $("mp4Player").addEventListener("canplay", function () {
      hideLoader();
      if ($("mp4Player").autoplay) tryPlayMp4();
    }, false);
    $("mp4Player").addEventListener("loadeddata", hideLoader, false);
    $("mp4Player").addEventListener("loadedmetadata", function () {
      if (state.currentVideo && state.currentVideo.sourceType === "mp4") {
        showMp4Controls(true);
        updateSeekUi();
      }
    }, false);
    $("mp4Player").addEventListener("playing", hideLoader, false);
    $("mp4Player").addEventListener("timeupdate", updateSeekUi, false);
    $("mp4Player").addEventListener("durationchange", updateSeekUi, false);
    $("mp4Player").addEventListener("play", updateSeekUi, false);
    $("mp4Player").addEventListener("pause", updateSeekUi, false);
    $("mp4Player").addEventListener("error", hideLoader, false);
    bindSheet();
    request("GET", "/api/videos", null, function (err, data) {
      if (err) return;
      state.settings = data.settings || {};
      state.videos = data.videos || [];
      render();
    });
  }

  init();
})();
