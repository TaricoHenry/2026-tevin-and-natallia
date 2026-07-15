// Wedding gallery + guest upload helper
// - Loads approved photo records into #galleryGrid when that container exists.
// - Handles guest uploads from #galleryUploadForm when that form exists.

(() => {
  const PROJECT_ID = "tevin-wedding";
  const LOCAL_API_BASE = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/api/v1`;
  const PRODUCTION_API_BASE = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/api/v1`;

  const galleryGrid = document.getElementById("galleryGrid");
  const galleryLoading = document.getElementById("galleryLoading");
  const galleryError = document.getElementById("galleryError");
  const galleryEmpty = document.getElementById("galleryEmpty");

  const uploadForm = document.getElementById("galleryUploadForm");
  const uploadFileInput = document.getElementById("galleryUploadFile");
  const uploadNameInput = document.getElementById("galleryUploadName");
  const uploadInviteInput = document.getElementById("galleryUploadInviteCode");
  const uploadPreview = document.getElementById("galleryUploadPreview");
  const uploadStatus = document.getElementById("galleryUploadStatus");
  const uploadButton = document.getElementById("galleryUploadButton");

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function getCurrentScriptApiBase() {
    const currentScript = document.currentScript;
    return currentScript?.dataset?.apiBase || "";
  }

  function getApiBaseUrl() {
    const override =
      window.WEDDING_GALLERY_API_BASE ||
      uploadForm?.dataset?.apiBase ||
      galleryGrid?.dataset?.apiBase ||
      getCurrentScriptApiBase();

    if (override) {
      return trimTrailingSlash(override);
    }

    const host = window.location.hostname;
    const port = window.location.port;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";

    // If Jekyll/Vite is serving the page locally, call the Functions emulator directly.
    // If Firebase Hosting emulator/prod is serving it, use /v1 so rewrites can handle it.
    if (isLocalHost && port !== "5000") {
      return LOCAL_API_BASE;
    }

    return PRODUCTION_API_BASE;
  }

  function buildApiUrl(path) {
    const apiBase = getApiBaseUrl();
    return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function getRequestedAlbum() {
    const albumFromGrid = galleryGrid?.dataset?.album || "";
    const albumFromUrl = new URLSearchParams(window.location.search).get("album") || "";
    return (albumFromGrid || albumFromUrl).trim().toLowerCase();
  }

  function getUploadAlbum() {
    const params = new URLSearchParams(window.location.search);
    const rawAlbum = uploadForm?.dataset?.album || params.get("album") || "guest";
    return cleanAlbum(rawAlbum);
  }

  function cleanAlbum(value) {
    return String(value || "guest")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "guest";
  }

  function normalizeInviteCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function getUploadInviteCode() {
    const params = new URLSearchParams(window.location.search);
    return normalizeInviteCode(
      uploadInviteInput?.value ||
      uploadForm?.dataset?.inviteCode ||
      params.get("token") ||
      params.get("inviteCode") ||
      params.get("code") ||
      ""
    );
  }

  function setElementVisible(element, isVisible) {
    if (!element) return;
    element.hidden = !isVisible;
    element.style.display = isVisible ? "" : "none";
  }

  function setStatus({ loading = false, error = "", empty = false } = {}) {
    setElementVisible(galleryLoading, loading);
    setElementVisible(galleryError, Boolean(error));
    setElementVisible(galleryEmpty, empty);

    if (galleryError && error) {
      galleryError.textContent = error;
    }
  }

  function setUploadStatus(message, type = "") {
    if (!uploadStatus) return;

    uploadStatus.textContent = message || "";
    uploadStatus.className = "gallery-upload-status";

    if (type) {
      uploadStatus.classList.add(`gallery-upload-status--${type}`);
    }
  }

  function setUploadBusy(isBusy) {
    if (uploadButton) {
      uploadButton.disabled = isBusy;
      uploadButton.textContent = isBusy ? "Uploading..." : "Upload photo(s)";
    }

    if (uploadFileInput) {
      uploadFileInput.disabled = isBusy;
    }
  }

  function normalizeUrl(value) {
    const rawValue = String(value || "").trim();

    if (!rawValue) return "";

    if (/^https?:\/\//i.test(rawValue)) {
      return rawValue;
    }

    if (rawValue.startsWith("/")) {
      return rawValue;
    }

    return buildApiUrl(rawValue);
  }

  function getPhotoImageUrl(photo, variant = "image") {
    if (variant === "thumb") {
      const thumbUrl = normalizeUrl(photo.thumbUrl);
      if (thumbUrl) return thumbUrl;
    }

    const fullUrl = normalizeUrl(photo.url);
    if (fullUrl) return fullUrl;

    // Fallback for older API response shapes.
    if (photo.id) {
      return buildApiUrl(`/photos/${encodeURIComponent(photo.id)}/${variant}`);
    }

    return "";
  }

  async function fetchApprovedPhotos() {
    const album = getRequestedAlbum();
    const params = new URLSearchParams();

    if (album) {
      params.set("album", album);
    }

    const endpoint = buildApiUrl(`/photos${params.toString() ? `?${params}` : ""}`);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || `Gallery request failed with status ${response.status}`);
    }

    return Array.isArray(data.photos) ? data.photos : [];
  }

  function getPhotoOrientation(photo) {
    const width = Number(photo.width);
    const height = Number(photo.height);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return "unknown";
    }

    if (height > width * 1.15) return "portrait";
    if (width > height * 1.15) return "landscape";
    return "square";
  }

  function createPhotoElement(photo, index) {
    const imageUrl = getPhotoImageUrl(photo, "image");
    const thumbUrl = getPhotoImageUrl(photo, "thumb") || imageUrl;

    if (!imageUrl || !thumbUrl) {
      return null;
    }

    const orientation = getPhotoOrientation(photo);
    const item = document.createElement("figure");
    item.className = `gallery-item gallery-item--${orientation}`;

    if (photo.album) {
      item.dataset.album = photo.album;
    }

    const wrapper = document.createElement("a");
    wrapper.className = "gallery-image-wrapper";
    wrapper.href = imageUrl;
    wrapper.target = "_blank";
    wrapper.rel = "noopener noreferrer";
    wrapper.setAttribute("aria-label", photo.altText || `Open wedding photo ${index + 1}`);

    const image = document.createElement("img");
    image.src = thumbUrl;
    image.alt = photo.altText || `Wedding gallery photo ${index + 1}`;
    image.loading = index < 4 ? "eager" : "lazy";
    image.decoding = "async";

    if (index < 4) {
      image.fetchPriority = "high";
    }

    const width = Number(photo.width);
    const height = Number(photo.height);

    if (Number.isFinite(width) && width > 0) {
      image.width = width;
    }

    if (Number.isFinite(height) && height > 0) {
      image.height = height;
    }

    const overlay = document.createElement("figcaption");
    overlay.className = "gallery-overlay";

    const label = document.createElement("span");
    label.className = "gallery-credit";
    label.textContent = photo.altText || photo.album || "View photo";

    overlay.appendChild(label);
    wrapper.appendChild(image);
    wrapper.appendChild(overlay);
    item.appendChild(wrapper);

    return item;
  }

  function renderPhotos(photos) {
    if (!galleryGrid) return;

    galleryGrid.innerHTML = "";
    galleryGrid.classList.toggle("is-empty", photos.length === 0);
    galleryGrid.dataset.photoCount = String(photos.length);

    if (photos.length === 0) {
      if (galleryEmpty) {
        setStatus({ empty: true });
      } else {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "gallery-empty";
        emptyMessage.textContent = "No gallery photos have been added yet.";
        galleryGrid.appendChild(emptyMessage);
      }
      return;
    }

    const fragment = document.createDocumentFragment();

    photos.forEach((photo, index) => {
      const photoElement = createPhotoElement(photo, index);
      if (photoElement) {
        fragment.appendChild(photoElement);
      }
    });

    galleryGrid.appendChild(fragment);
  }

  async function loadGallery() {
    if (!galleryGrid) {
      return;
    }

    galleryGrid.classList.add("is-loading");
    setStatus({ loading: true });

    try {
      const photos = await fetchApprovedPhotos();
      renderPhotos(photos);
      setStatus({ empty: photos.length === 0 });
    } catch (error) {
      console.error("Gallery error:", error);
      galleryGrid.innerHTML = "";
      galleryGrid.classList.add("is-empty");
      setStatus({
        error: "Sorry, the gallery could not be loaded right now.",
      });
    } finally {
      galleryGrid.classList.remove("is-loading");
      setElementVisible(galleryLoading, false);
    }
  }

  function getFilesFromInput() {
    return Array.from(uploadFileInput?.files || []).filter((file) => {
      return file && file.type && file.type.startsWith("image/");
    });
  }

  function renderUploadPreview() {
    if (!uploadPreview) return;

    const files = getFilesFromInput();
    uploadPreview.innerHTML = "";

    if (files.length === 0) {
      uploadPreview.hidden = true;
      return;
    }

    uploadPreview.hidden = false;

    const summary = document.createElement("div");
    summary.className = "gallery-upload-preview-summary";
    summary.textContent = `${files.length} photo${files.length === 1 ? "" : "s"} selected`;
    uploadPreview.appendChild(summary);

    const list = document.createElement("div");
    list.className = "gallery-upload-preview-grid";

    files.slice(0, 8).forEach((file) => {
      const item = document.createElement("div");
      item.className = "gallery-upload-preview-item";

      const image = document.createElement("img");
      const objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
      image.alt = file.name;
      image.onload = () => URL.revokeObjectURL(objectUrl);

      const label = document.createElement("span");
      label.textContent = file.name;

      item.appendChild(image);
      item.appendChild(label);
      list.appendChild(item);
    });

    if (files.length > 8) {
      const more = document.createElement("div");
      more.className = "gallery-upload-preview-more";
      more.textContent = `+${files.length - 8} more`;
      list.appendChild(more);
    }

    uploadPreview.appendChild(list);
  }

  function getImageDimensions(file) {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        const width = image.naturalWidth || null;
        const height = image.naturalHeight || null;
        URL.revokeObjectURL(objectUrl);
        resolve({ width, height });
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: null, height: null });
      };

      image.src = objectUrl;
    });
  }

  async function requestUploadSession(file, dimensions) {
    const inviteCode = getUploadInviteCode();
    const guestName = String(uploadNameInput?.value || "").trim();
    const payload = {
      fileName: file.name || "wedding-photo.jpg",
      contentType: file.type || "image/jpeg",
      altText: guestName ? `Photo shared by ${guestName}` : "Wedding guest photo",
      album: getUploadAlbum(),
      sizeBytes: file.size,
      width: dimensions.width,
      height: dimensions.height,
      createThumbnail: false,
    };

    if (guestName) {
      payload.guestName = guestName;
    }

    if (inviteCode) {
      payload.inviteCode = inviteCode;
    }

    const response = await fetch(buildApiUrl("/photos/upload-url"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const validationMessage = Array.isArray(data.errors)
        ? data.errors.map((error) => error.message).join(" ")
        : "";
      throw new Error(data.message || validationMessage || `Could not start upload for ${file.name}`);
    }

    return data;
  }

  async function uploadFileToR2(file, uploadSession) {
    const uploadUrl = uploadSession?.upload?.url;

    if (!uploadUrl) {
      throw new Error(`Upload URL was not returned for ${file.name}`);
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: uploadSession.upload.method || "PUT",
      headers: uploadSession.upload.requiredHeaders || {
        "Content-Type": file.type || "image/jpeg",
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Photo upload failed for ${file.name}: ${uploadResponse.status}`);
    }
  }

  async function completeUpload(uploadSession, file, dimensions) {
    const photoId = uploadSession?.photoId;
    const uploadToken = uploadSession?.uploadToken;

    if (!photoId || !uploadToken) {
      throw new Error("Upload completion details were not returned.");
    }

    const response = await fetch(buildApiUrl(`/photos/${encodeURIComponent(photoId)}/complete`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        uploadToken,
        thumbUploaded: false,
        sizeBytes: file.size,
        width: dimensions.width,
        height: dimensions.height,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || `Could not finish upload for ${file.name}`);
    }

    return data;
  }

  async function uploadOneGuestPhoto(file, index, total) {
    setUploadStatus(`Preparing ${index + 1} of ${total}: ${file.name}`, "working");
    const dimensions = await getImageDimensions(file);

    const uploadSession = await requestUploadSession(file, dimensions);

    setUploadStatus(`Uploading ${index + 1} of ${total}: ${file.name}`, "working");
    await uploadFileToR2(file, uploadSession);

    setUploadStatus(`Finishing ${index + 1} of ${total}: ${file.name}`, "working");
    await completeUpload(uploadSession, file, dimensions);
  }

  async function handleGuestUpload(event) {
    event.preventDefault();

    const files = getFilesFromInput();

    if (files.length === 0) {
      setUploadStatus("Choose at least one image to upload.", "error");
      return;
    }

    setUploadBusy(true);
    setUploadStatus("Starting upload...", "working");

    try {
      for (let index = 0; index < files.length; index += 1) {
        await uploadOneGuestPhoto(files[index], index, files.length);
      }

      setUploadStatus(
        `Uploaded ${files.length} photo${files.length === 1 ? "" : "s"}. Thank you! Photos will appear after review.`,
        "success"
      );

      uploadForm.reset();
      renderUploadPreview();
    } catch (error) {
      console.error("Guest photo upload error:", error);
      setUploadStatus(error.message || "Sorry, your photo could not be uploaded.", "error");
    } finally {
      setUploadBusy(false);
    }
  }

  function initializeGuestUpload() {
    if (!uploadForm) return;

    if (uploadInviteInput && !uploadInviteInput.value) {
      uploadInviteInput.value = getUploadInviteCode();
    }

    uploadFileInput?.addEventListener("change", renderUploadPreview);
    uploadForm.addEventListener("submit", handleGuestUpload);
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  window.refreshGallery = loadGallery;
  window.loadWeddingGallery = loadGallery;

  onReady(() => {
    loadGallery();
    initializeGuestUpload();
  });
})();
