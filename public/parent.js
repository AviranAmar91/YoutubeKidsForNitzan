(function () {
  var state = {
    settings: {},
    videos: [],
    editingId: null,
    unlocked: false
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
      var payload = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch (err) {}
      if (xhr.status >= 200 && xhr.status < 300) callback(null, payload);
      else callback(new Error(payload.error || "Request failed"));
    };
    xhr.send(data ? JSON.stringify(data) : null);
  }

  function thumb(video) {
    if (video.thumbnailUrl) return video.thumbnailUrl;
    if (video.sourceType === "mp4") return "";
    return "https://img.youtube.com/vi/" + encodeURIComponent(video.youtubeId) + "/hqdefault.jpg";
  }

  function load(callback) {
    request("GET", "/api/videos", null, function (err, data) {
      if (err) return;
      state.settings = data.settings || {};
      state.videos = data.videos || [];
      fillSettings();
      renderList();
      if (callback) callback();
    });
  }

  function fillSettings() {
    $("childNameInput").value = state.settings.childName || "";
    $("parentPinInput").value = state.settings.parentPin || "";
    $("autoplayInput").checked = state.settings.autoplay === true;
  }

  function clearForm() {
    state.editingId = null;
    $("titleInput").value = "";
    $("sourceTypeInput").value = "youtube";
    $("urlInput").value = "";
    $("thumbnailInput").value = "";
    $("categoryInput").value = "";
    $("enabledInput").checked = true;
    $("saveVideoButton").innerHTML = "Add video";
    $("cancelEditButton").className = "secondary hidden";
  }

  function renderThumb(video) {
    var imgSrc = thumb(video);
    var node = document.createElement(imgSrc ? "img" : "div");
    if (imgSrc) {
      node.src = imgSrc;
      node.alt = "";
    } else {
      node.className = "admin-thumb-fallback";
      node.appendChild(document.createTextNode("MP4"));
    }
    return node;
  }

  function renderList() {
    var list = $("adminList");
    list.innerHTML = "";
    state.videos.forEach(function (video) {
      var item = document.createElement("div");
      item.className = "admin-item";

      var body = document.createElement("div");
      var title = document.createElement("strong");
      title.appendChild(document.createTextNode(video.title));
      var meta = document.createElement("p");
      meta.appendChild(document.createTextNode(video.category + " - " + (video.sourceType === "mp4" ? "MP4 stream" : "YouTube") + " - " + (video.enabled ? "shown" : "hidden")));
      body.appendChild(title);
      body.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "admin-actions";

      var edit = document.createElement("button");
      edit.type = "button";
      edit.appendChild(document.createTextNode("Edit"));
      edit.onclick = function () {
        state.editingId = video.id;
        $("titleInput").value = video.title;
        $("sourceTypeInput").value = video.sourceType === "mp4" ? "mp4" : "youtube";
        $("urlInput").value = video.sourceType === "mp4" ? video.videoUrl : video.youtubeId;
        $("thumbnailInput").value = video.thumbnailUrl || "";
        $("categoryInput").value = video.category;
        $("enabledInput").checked = video.enabled;
        $("saveVideoButton").innerHTML = "Save video";
        $("cancelEditButton").className = "secondary";
        window.scrollTo(0, 0);
      };

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.appendChild(document.createTextNode("Delete"));
      remove.onclick = function () {
        if (!confirm("Delete this video?")) return;
        request("DELETE", "/api/videos/" + encodeURIComponent(video.id), null, function () {
          load();
        });
      };

      actions.appendChild(edit);
      actions.appendChild(remove);
      item.appendChild(renderThumb(video));
      item.appendChild(body);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function saveVideo(event) {
    event.preventDefault();
    var payload = {
      title: $("titleInput").value,
      sourceType: $("sourceTypeInput").value,
      youtubeId: $("urlInput").value,
      videoUrl: $("urlInput").value,
      thumbnailUrl: $("thumbnailInput").value,
      category: $("categoryInput").value,
      enabled: $("enabledInput").checked
    };
    var method = state.editingId ? "PUT" : "POST";
    var url = state.editingId ? "/api/videos/" + encodeURIComponent(state.editingId) : "/api/videos";
    request(method, url, payload, function (err) {
      if (err) {
        alert(err.message);
        return;
      }
      clearForm();
      load();
    });
  }

  function saveSettings(event) {
    event.preventDefault();
    request("PUT", "/api/settings", {
      childName: $("childNameInput").value,
      parentPin: $("parentPinInput").value,
      autoplay: $("autoplayInput").checked,
      colorTheme: "sunny"
    }, function (err) {
      if (err) alert(err.message);
      else load();
    });
  }

  function unlock(event) {
    event.preventDefault();
    if ($("pinInput").value === String(state.settings.parentPin || "1234")) {
      state.unlocked = true;
      $("pinGate").className = "panel hidden";
      $("adminPanel").className = "";
      $("pinError").className = "error hidden";
    } else {
      $("pinError").className = "error";
    }
  }

  function init() {
    $("pinForm").onsubmit = unlock;
    $("videoForm").onsubmit = saveVideo;
    $("settingsForm").onsubmit = saveSettings;
    $("cancelEditButton").onclick = clearForm;
    load();
  }

  init();
})();
