import React, { useEffect, useMemo, useState } from "react";

// ===================================
// API BASE
// ===================================
// This points to the admin endpoints.
// Using /v1/admin works nicely with the Vite proxy in local development.
const API_BASE = "/v1/admin";

// ===================================
// EMPTY HOUSEHOLD TEMPLATE
// ===================================
// IMPORTANT CHANGE:
// - code is system-generated
// - uniqueUrl is system-generated
// - memberId is system-generated
//
// These fields are still present in state because the UI displays them,
// but they are NOT entered by the user.
const emptyGuest = {
  household: "",
  householdSize: 1,
  code: "",
  uniqueUrl: "",
  allResponded: false,
  members: [{ memberId: "", name: "", personalizedAddy: "", rsvp: null }],
};

const emptyPhotoUpload = {
  files: [],
  altText: "",
  album: "ceremony",
  approved: true,
};

// ===================================
// CSV VALUE ESCAPER
// ===================================
// Ensures commas, quotes, and line breaks are safely exported.
function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatDateTime(value) {
  if (!value) return "";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function inferImageContentType(file) {
  if (file?.type) return file.type;

  const name = String(file?.name || "").toLowerCase();

  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";

  return "application/octet-stream";
}

function readImageDimensions(file) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith("image/")) {
      resolve({ width: null, height: null });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const dimensions = {
        width: image.naturalWidth || null,
        height: image.naturalHeight || null,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: null, height: null });
    };

    image.src = objectUrl;
  });
}

// ===================================
// STATUS BADGES
// ===================================
// Displays either a complete badge or a progress badge for each household.
function StatusText({ row }) {
  if (row.allResponded) {
    return <span style={styles.complete}>Complete</span>;
  }

  const responded = (row.members || []).filter(
    (m) => m.rsvp === "yes" || m.rsvp === "no"
  ).length;
  const total = (row.members || []).length;

  return <span style={styles.pending}>{responded}/{total} replied</span>;
}

function PhotoStatusText({ photo }) {
  if (photo.uploadStatus === "pending_upload") {
    return <span style={styles.pending}>Upload pending</span>;
  }

  if (photo.approved) {
    return <span style={styles.complete}>Approved</span>;
  }

  return <span style={styles.pending}>Needs review</span>;
}

// ===================================
// API HELPER
// ===================================
// Centralized fetch helper for the admin dashboard.
// Keeps all requests using cookies and JSON by default.
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 401) {
    throw new Error("Unauthorized");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export default function AdminDashboard() {
  // ===================================
  // LOCAL STATE
  // ===================================
  // These hold auth info, UI state, loaded data, and editor draft state.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [selected, setSelected] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(emptyGuest);

  const [activeTab, setActiveTab] = useState("households");
  const [photos, setPhotos] = useState([]);
  const [photoSearch, setPhotoSearch] = useState("");
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState("");
  const [photoUpload, setPhotoUpload] = useState(emptyPhotoUpload);
  const [photoInputKey, setPhotoInputKey] = useState(0);

  // ===================================
  // FILTERED HOUSEHOLDS
  // ===================================
  // Filters households based on search text across household/meta/member data.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((row) => {
      const memberText = (row.members || [])
        .map((m) => `${m.name} ${m.personalizedAddy} ${m.memberId} ${m.rsvp || ""}`)
        .join(" ")
        .toLowerCase();

      return [row.household, row.code, row.uniqueUrl, memberText]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search]);

  const filteredPhotos = useMemo(() => {
    const q = photoSearch.trim().toLowerCase();
    if (!q) return photos;

    return photos.filter((photo) => {
      return [
        photo.id,
        photo.altText,
        photo.album,
        photo.uploaderType,
        photo.inviteCode,
        photo.guestName,
        photo.uploadStatus,
        photo.approved ? "approved" : "pending",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [photos, photoSearch]);

  // ===================================
  // SUMMARY COUNTS
  // ===================================
  // These dashboard totals are derived from the loaded household rows.
  // No extra API calls are needed because the household data already contains
  // each member and their RSVP state.
  const totalGuests = rows.reduce((sum, row) => {
    return sum + (row.members?.length || 0);
  }, 0);

  const completedGuests = rows.reduce((sum, row) => {
    const respondedCount = (row.members || []).filter(
      (member) => member.rsvp === "yes" || member.rsvp === "no"
    ).length;

    return sum + respondedCount;
  }, 0);

  const approvedPhotos = photos.filter((photo) => photo.approved).length;
  const pendingReviewPhotos = photos.filter((photo) => !photo.approved).length;
  const guestUploadedPhotos = photos.filter(
    (photo) => photo.uploaderType === "guest"
  ).length;

  // ===================================
  // LOAD HOUSEHOLDS
  // ===================================
  // Fetches all household rows for the admin table.
  async function loadRows() {
    setLoading(true);
    setError("");

    try {
      const data = await api("/households");
      setRows(data.households || []);
    } catch (err) {
      setError(err.message);
      if (err.message === "Unauthorized") {
        setIsAuthed(false);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadPhotos() {
    setPhotoLoading(true);
    setError("");

    try {
      const data = await api("/photos");
      setPhotos(data.photos || []);
    } catch (err) {
      setError(err.message);
      if (err.message === "Unauthorized") {
        setIsAuthed(false);
      }
    } finally {
      setPhotoLoading(false);
    }
  }

  async function refreshCurrentTab() {
    if (activeTab === "photos") {
      await loadPhotos();
      return;
    }

    await loadRows();
  }

  // ===================================
  // LOAD DATA AFTER LOGIN
  // ===================================
  // As soon as the user is authenticated, load dashboard data.
  useEffect(() => {
    if (isAuthed) {
      loadRows();
      loadPhotos();
    }
  }, [isAuthed]);

  // ===================================
  // LOGIN HANDLER
  // ===================================
  // Sends username/password to the admin login endpoint.
  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await api("/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setIsAuthed(true);
      setInfo("Logged in");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  // ===================================
  // LOGOUT HANDLER
  // ===================================
  // Ends the admin session and clears local UI state.
  async function handleLogout() {
    try {
      await api("/logout", { method: "POST" });
    } catch {}

    setIsAuthed(false);
    setRows([]);
    setPhotos([]);
    setUsername("");
    setPassword("");
  }

  // ===================================
  // OPEN EDITOR
  // ===================================
  // Opens the modal for either editing an existing household
  // or creating a new one using the empty template.
  function openEditor(row) {
    const next = row
      ? JSON.parse(JSON.stringify(row))
      : JSON.parse(JSON.stringify(emptyGuest));

    if (!row) {
      next.members = [{ memberId: "", name: "", personalizedAddy: "", rsvp: null }];
    }

    setSelected(row?.code || null);
    setDraft(next);
    setEditorOpen(true);
  }

  // ===================================
  // DRAFT FIELD UPDATERS
  // ===================================
  // These helpers update either household-level fields or member-level fields.
  function updateDraftField(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateMember(index, key, value) {
    setDraft((prev) => {
      const members = [...prev.members];
      members[index] = { ...members[index], [key]: value };
      return { ...prev, members };
    });
  }

  function updatePhotoUploadField(key, value) {
    setPhotoUpload((prev) => ({ ...prev, [key]: value }));
  }

  // ===================================
  // MEMBER ROW MANAGEMENT
  // ===================================
  // Adds and removes editable member rows inside the modal.
  function addMember() {
    setDraft((prev) => ({
      ...prev,
      members: [
        ...prev.members,
        { memberId: "", name: "", personalizedAddy: "", rsvp: null },
      ],
    }));
  }

  function removeMember(index) {
    setDraft((prev) => ({
      ...prev,
      members: prev.members.filter((_, i) => i !== index),
    }));
  }

  // ===================================
  // SAVE HOUSEHOLD
  // ===================================
  // IMPORTANT CHANGE:
  // - code is NOT sent from the UI
  // - uniqueUrl is NOT sent from the UI
  // - memberId is NOT sent from the UI
  //
  // Those values are generated and controlled by the backend only.
  async function saveDraft() {
    setError("");
    setInfo("");

    const payload = {
      household: draft.household,
      householdSize: Number(draft.householdSize || draft.members.length || 1),
      members: draft.members.map((member) => ({
        name: member.name,
        personalizedAddy: member.personalizedAddy || "",
        rsvp: member.rsvp || null,
      })),
    };

    try {
      if (selected) {
        await api(`/households/${selected}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setInfo("Household updated");
      } else {
        await api("/households", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setInfo("Household created");
      }

      setEditorOpen(false);
      await loadRows();
    } catch (err) {
      setError(err.message);
    }
  }

  async function uploadOneAdminPhoto(file, index, total) {
    const contentType = inferImageContentType(file);

    if (!contentType.startsWith("image/")) {
      throw new Error(`${file.name} is not a supported image file.`);
    }

    const dimensions = await readImageDimensions(file);
    const altText = photoUpload.altText
      ? `${photoUpload.altText}${total > 1 ? ` ${index + 1}` : ""}`
      : file.name;

    setPhotoUploadProgress(`Preparing ${index + 1} of ${total}: ${file.name}`);

    const session = await api("/photos/upload-url", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        contentType,
        altText,
        album: photoUpload.album || "general",
        sizeBytes: file.size,
        width: dimensions.width,
        height: dimensions.height,
        approved: photoUpload.approved,
        createThumbnail: false,
      }),
    });

    if (!session.upload?.url) {
      throw new Error(`Upload URL was not returned for ${file.name}.`);
    }

    setPhotoUploadProgress(`Uploading ${index + 1} of ${total}: ${file.name}`);

    const uploadResponse = await fetch(session.upload.url, {
      method: session.upload.method || "PUT",
      headers: session.upload.requiredHeaders || {
        "Content-Type": contentType,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      const uploadText = await uploadResponse.text().catch(() => "");
      throw new Error(
        uploadText || `Cloudflare R2 upload failed for ${file.name} with ${uploadResponse.status}`
      );
    }

    setPhotoUploadProgress(`Finishing ${index + 1} of ${total}: ${file.name}`);

    await api(`/photos/${session.photoId}/complete`, {
      method: "POST",
      body: JSON.stringify({
        thumbUploaded: false,
        approved: photoUpload.approved,
        sizeBytes: file.size,
        width: dimensions.width,
        height: dimensions.height,
      }),
    });

    return session.photoId;
  }

  async function uploadAdminPhoto(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setPhotoUploadProgress("");

    const files = Array.from(photoUpload.files || []);

    if (!files.length) {
      setError("Choose at least one image before uploading.");
      return;
    }

    setPhotoUploading(true);

    try {
      for (let i = 0; i < files.length; i += 1) {
        await uploadOneAdminPhoto(files[i], i, files.length);
      }

      setPhotoUpload(emptyPhotoUpload);
      setPhotoInputKey((value) => value + 1);
      setPhotoUploadProgress("");
      setInfo(`${files.length} photo${files.length === 1 ? "" : "s"} uploaded successfully`);
      await loadPhotos();
    } catch (err) {
      setError(err.message || "Photo upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function updatePhotoApproval(photo, approved) {
    setError("");
    setInfo("");

    try {
      await api(`/photos/${photo.id}`, {
        method: "PUT",
        body: JSON.stringify({ approved }),
      });
      setInfo(approved ? "Photo approved" : "Photo moved back to review");
      await loadPhotos();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deletePhoto(photo, deleteFiles = false) {
    const message = deleteFiles
      ? "Delete this photo record and the Cloudflare R2 files?"
      : "Delete this photo record? The Cloudflare R2 files will be kept.";

    if (!window.confirm(message)) {
      return;
    }

    setError("");
    setInfo("");

    try {
      await api(`/photos/${photo.id}?deleteFiles=${deleteFiles ? "true" : "false"}`, {
        method: "DELETE",
      });
      setInfo(deleteFiles ? "Photo and files deleted" : "Photo record deleted");
      await loadPhotos();
    } catch (err) {
      setError(err.message);
    }
  }

  // ===================================
  // EXPORT CSV
  // ===================================
  // Exports one row per member in a sheet-friendly format.
  // The first member row of a household gets the household size.
  // Later member rows in the same household leave that field blank,
  // which mirrors the layout style you showed.
  function exportCsv() {
    const headers = [
      "name",
      "personalizedAddress",
      "personalizedHousholdName",
      "housholdSize",
      "rsvp",
      "Unique URL",
    ];

    const lines = [headers.map(csvEscape).join(",")];

    rows.forEach((household) => {
      const members = household.members || [];

      members.forEach((member, index) => {
        const row = [
          member.name || "",
          member.personalizedAddy || "",
          household.household || "",
          index === 0 ? household.householdSize || members.length || "" : "",
          member.rsvp || "",
          household.uniqueUrl || "",
        ];

        lines.push(row.map(csvEscape).join(","));
      });
    });

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "guest-households-export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function renderSummaryCards() {
    if (activeTab === "photos") {
      return (
        <div style={styles.summaryRow}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryAccentBar} />
            <div style={styles.summaryLabel}>Photos</div>
            <div style={styles.summaryValue}>{photos.length}</div>
            <div style={styles.summaryHint}>Total photo records in the dashboard</div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryAccentBarSoft} />
            <div style={styles.summaryLabel}>Approved</div>
            <div style={styles.summaryValue}>{approvedPhotos}</div>
            <div style={styles.summaryHint}>Photos visible in the public gallery</div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryAccentBarGold} />
            <div style={styles.summaryLabel}>Needs Review</div>
            <div style={styles.summaryValue}>{pendingReviewPhotos}</div>
            <div style={styles.summaryHint}>Guest or admin uploads waiting for approval</div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryAccentBarRose} />
            <div style={styles.summaryLabel}>Guest Uploads</div>
            <div style={styles.summaryValue}>{guestUploadedPhotos}</div>
            <div style={styles.summaryHint}>Photos uploaded with an invitation code</div>
          </div>
        </div>
      );
    }

    return (
      <div style={styles.summaryRow}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryAccentBar} />
          <div style={styles.summaryLabel}>Households</div>
          <div style={styles.summaryValue}>{rows.length}</div>
          <div style={styles.summaryHint}>Total household records in the dashboard</div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryAccentBarSoft} />
          <div style={styles.summaryLabel}>Completed Households</div>
          <div style={styles.summaryValue}>
            {rows.filter((row) => row.allResponded).length}
          </div>
          <div style={styles.summaryHint}>Households where every member has replied</div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryAccentBarGold} />
          <div style={styles.summaryLabel}>Guests</div>
          <div style={styles.summaryValue}>{totalGuests}</div>
          <div style={styles.summaryHint}>Total invited guests across all households</div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryAccentBarRose} />
          <div style={styles.summaryLabel}>Completed Guests</div>
          <div style={styles.summaryValue}>{completedGuests}</div>
          <div style={styles.summaryHint}>Guests with an RSVP of yes or no</div>
        </div>
      </div>
    );
  }

  function renderHouseholdsTab() {
    return (
      <>
        <div style={styles.toolbarCard}>
          <div style={styles.toolbarHeader}>Search and review</div>
          <input
            style={styles.searchInput}
            placeholder="Search household, code, member name, or RSVP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={styles.tableCard}>
          <div style={styles.tableHeader}>
            <div style={styles.tableTitle}>Household records</div>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Code</th>
                  <th style={styles.th}>URL</th>
                  <th style={styles.th}>Household</th>
                  <th style={styles.th}>Size</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Members</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.code} style={styles.tr}>
                    <td style={styles.tdCode}>{row.code}</td>
                    <td style={styles.tdUrl}>{row.uniqueUrl}</td>
                    <td style={styles.td}>{row.household}</td>
                    <td style={styles.td}>{row.householdSize}</td>
                    <td style={styles.td}>
                      <StatusText row={row} />
                    </td>
                    <td style={styles.td}>
                      {(row.members || [])
                        .map((m) => `${m.name} (${m.rsvp || "pending"})`)
                        .join(", ")}
                    </td>
                    <td style={styles.td}>
                      <button
                        style={styles.buttonTable}
                        onClick={() => openEditor(row)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}

                {!loading && filteredRows.length === 0 ? (
                  <tr>
                    <td style={styles.emptyCell} colSpan="7">
                      No households found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  function renderPhotosTab() {
    return (
      <>
        <div style={styles.photoUploadCard}>
          <div>
            <div style={styles.toolbarHeader}>Upload photos</div>
            <p style={styles.tableSubtleText}>
              Select one or more images. Each file is uploaded directly to Cloudflare R2 using the presigned URL flow, then saved to Firestore through the admin API.
            </p>
          </div>

          <form onSubmit={uploadAdminPhoto} style={styles.photoUploadForm}>
            <label style={styles.label}>
              Image files
              <input
                key={photoInputKey}
                style={styles.input}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                disabled={photoUploading}
                onChange={(e) =>
                  updatePhotoUploadField("files", Array.from(e.target.files || []))
                }
              />
            </label>

            <label style={styles.label}>
              Album
              <input
                style={styles.input}
                value={photoUpload.album}
                onChange={(e) => updatePhotoUploadField("album", e.target.value)}
                placeholder="ceremony"
              />
            </label>

            <label style={styles.label}>
              Alt text prefix
              <input
                style={styles.input}
                value={photoUpload.altText}
                onChange={(e) => updatePhotoUploadField("altText", e.target.value)}
                placeholder="Bride and groom at the ceremony"
              />
            </label>

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={photoUpload.approved}
                onChange={(e) => updatePhotoUploadField("approved", e.target.checked)}
              />
              Approve immediately
            </label>

            {photoUpload.files?.length ? (
              <div style={styles.selectedFilesBox}>
                <div style={styles.tableSubtleText}>
                  {photoUpload.files.length} file{photoUpload.files.length === 1 ? "" : "s"} selected
                </div>
                <div style={styles.selectedFilesList}>
                  {photoUpload.files.map((file) => (
                    <span key={`${file.name}-${file.size}`} style={styles.selectedFilePill}>
                      {file.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {photoUploadProgress ? (
              <div style={styles.info}>{photoUploadProgress}</div>
            ) : null}

            <button
              style={styles.buttonPrimary}
              type="submit"
              disabled={photoUploading || !photoUpload.files?.length}
            >
              {photoUploading ? "Uploading..." : "Upload selected photos"}
            </button>
          </form>
        </div>

        <div style={styles.toolbarCard}>
          <div style={styles.toolbarHeader}>Search photos</div>
          <input
            style={styles.searchInput}
            placeholder="Search photo ID, album, guest, invite code, or approval state..."
            value={photoSearch}
            onChange={(e) => setPhotoSearch(e.target.value)}
          />
        </div>

        <div style={styles.tableCard}>
          <div style={styles.tableHeader}>
            <div style={styles.tableTitle}>Photo review</div>
            <div style={styles.tableSubtleText}>
              Approve guest uploads, review metadata, open images, or remove records.
            </div>
          </div>

          <div style={styles.photoGrid}>
            {filteredPhotos.map((photo) => (
              <div key={photo.id} style={styles.photoCard}>
                <a
                  href={photo.url || photo.thumbUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.photoPreviewLink}
                >
                  {photo.thumbUrl || photo.url ? (
                    <img
                      style={styles.photoImage}
                      src={photo.thumbUrl || photo.url}
                      alt={photo.altText || "Wedding photo"}
                      loading="lazy"
                    />
                  ) : (
                    <div style={styles.photoMissing}>No image URL</div>
                  )}
                </a>

                <div style={styles.photoCardBody}>
                  <div style={styles.photoCardTopRow}>
                    <PhotoStatusText photo={photo} />
                    <span style={styles.photoMetaPill}>{photo.album || "general"}</span>
                  </div>

                  <div style={styles.photoAltText}>
                    {photo.altText || "No alt text provided"}
                  </div>

                  <div style={styles.photoMetaGrid}>
                    <div>
                      <div style={styles.photoMetaLabel}>Uploader</div>
                      <div style={styles.photoMetaValue}>{photo.uploaderType || "admin"}</div>
                    </div>
                    <div>
                      <div style={styles.photoMetaLabel}>Guest</div>
                      <div style={styles.photoMetaValue}>{photo.guestName || "-"}</div>
                    </div>
                    <div>
                      <div style={styles.photoMetaLabel}>Invite</div>
                      <div style={styles.photoMetaValue}>{photo.inviteCode || "-"}</div>
                    </div>
                    <div>
                      <div style={styles.photoMetaLabel}>Uploaded</div>
                      <div style={styles.photoMetaValue}>{formatDateTime(photo.uploadedAt) || "-"}</div>
                    </div>
                  </div>

                  <div style={styles.photoIdText}>{photo.id}</div>

                  <div style={styles.photoButtons}>
                    {photo.approved ? (
                      <button
                        style={styles.buttonTable}
                        onClick={() => updatePhotoApproval(photo, false)}
                      >
                        Unapprove
                      </button>
                    ) : (
                      <button
                        style={styles.buttonPrimarySmall}
                        onClick={() => updatePhotoApproval(photo, true)}
                      >
                        Approve
                      </button>
                    )}

                    <a
                      style={styles.buttonLink}
                      href={photo.url || photo.thumbUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>

                    <button
                      style={styles.buttonDangerSmall}
                      onClick={() => deletePhoto(photo, false)}
                    >
                      Delete record
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!photoLoading && filteredPhotos.length === 0 ? (
              <div style={styles.emptyPhotoState}>No photos found.</div>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  // ===================================
  // LOGIN SCREEN
  // ===================================
  // Rendered only when the user is not authenticated.
  if (!isAuthed) {
    return (
      <div style={styles.page}>
        <div style={styles.backgroundGlowOne} />
        <div style={styles.backgroundGlowTwo} />

        <div style={styles.loginShell}>
          <div style={styles.loginCard}>
            <div style={styles.loginBadge}>Wedding Admin Portal Login</div>
            <h1 style={styles.heroTitle}>Tevin and Natallia</h1>
            <p style={styles.heroSubtitle}>
              Sign in to manage households, guest details, unique codes, RSVP progress, and gallery photos.
            </p>

            <form onSubmit={handleLogin} style={styles.form}>
              <label style={styles.label}>
                Username
                <input
                  style={styles.input}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>

              <label style={styles.label}>
                Password
                <input
                  style={styles.input}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              {error ? <div style={styles.error}>{error}</div> : null}

              <button style={styles.buttonPrimary} type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ===================================
  // MAIN DASHBOARD
  // ===================================
  // Rendered after login and shows summary cards, search, table, and editor modal.
  return (
    <div style={styles.page}>
      <div style={styles.backgroundGlowOne} />
      <div style={styles.backgroundGlowTwo} />

      <div style={styles.dashboardContainer}>
        <div style={styles.topPanel}>
          <div>
            <div style={styles.topBadge}>Wedding Admin Dashboard</div>
            <h1 style={styles.dashboardTitle}>Tevin and Natallia</h1>
            <p style={styles.dashboardSubtitle}>
              Manage households, update invitation links, track RSVP progress, review guest photos, and upload gallery images.
            </p>
          </div>

          <div style={styles.headerButtons}>
            <button style={styles.buttonSecondary} onClick={refreshCurrentTab}>
              Refresh
            </button>
            {activeTab === "households" ? (
              <>
                <button style={styles.buttonSecondary} onClick={exportCsv}>
                  Export CSV
                </button>
                <button style={styles.buttonPrimary} onClick={() => openEditor(null)}>
                  Add household
                </button>
              </>
            ) : null}
            <button style={styles.buttonGhost} onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>

        <div style={styles.tabBar}>
          <button
            style={activeTab === "households" ? styles.tabButtonActive : styles.tabButton}
            onClick={() => setActiveTab("households")}
          >
            Households
          </button>
          <button
            style={activeTab === "photos" ? styles.tabButtonActive : styles.tabButton}
            onClick={() => setActiveTab("photos")}
          >
            Photos
          </button>
        </div>

        {renderSummaryCards()}

        {error ? <div style={styles.error}>{error}</div> : null}
        {info ? <div style={styles.info}>{info}</div> : null}

        {activeTab === "photos" ? renderPhotosTab() : renderHouseholdsTab()}

        {editorOpen && (
          <div style={styles.modalBackdrop}>
            <div style={styles.modal}>
              <div style={styles.modalHeader}>
                <div>
                  <div style={styles.modalBadge}>
                    {selected ? "Editing household" : "Creating household"}
                  </div>
                  <h2 style={styles.modalTitle}>
                    {selected ? "Edit household" : "Add household"}
                  </h2>
                </div>
              </div>

              {/* ===================================
                  SYSTEM GENERATED IDENTIFIERS
                  ===================================
                  These are shown for visibility only.
                  They are not editable by the user.
              */}
              {selected ? (
                <div style={styles.readOnlyInfoGrid}>
                  <label style={styles.label}>
                    6-char code
                    <input
                      style={styles.inputReadOnly}
                      value={draft.code || ""}
                      readOnly
                    />
                  </label>

                  <label style={styles.label}>
                    Unique URL
                    <input
                      style={styles.inputReadOnly}
                      value={draft.uniqueUrl || ""}
                      readOnly
                    />
                  </label>
                </div>
              ) : (
                <div style={styles.info}>
                  The 6-digit code and unique URL will be generated automatically when you save this household.
                </div>
              )}

              <div style={styles.formGrid}>
                <label style={styles.label}>
                  Household
                  <input
                    style={styles.input}
                    value={draft.household}
                    onChange={(e) => updateDraftField("household", e.target.value)}
                  />
                </label>

                <label style={styles.label}>
                  Household size
                  <input
                    style={styles.input}
                    type="number"
                    min="1"
                    value={draft.householdSize}
                    onChange={(e) =>
                      updateDraftField("householdSize", e.target.value)
                    }
                  />
                </label>
              </div>

              <div style={styles.membersHeader}>
                <div>
                  <div style={styles.membersTitle}>Members</div>
                  <div style={styles.membersSubtitle}>
                    Edit guest details, personalized greetings, and RSVP states. Member IDs are generated automatically.
                  </div>
                </div>
              </div>

              {draft.members.map((member, index) => (
                <div key={`${member.memberId || "new"}-${index}`} style={styles.memberBox}>
                  <label style={styles.label}>
                    Member ID
                    <input
                      style={styles.inputReadOnly}
                      value={member.memberId || "Will be generated automatically"}
                      readOnly
                    />
                  </label>

                  <label style={styles.label}>
                    Name
                    <input
                      style={styles.input}
                      value={member.name}
                      onChange={(e) => updateMember(index, "name", e.target.value)}
                    />
                  </label>

                  <label style={styles.label}>
                    Personalized address
                    <input
                      style={styles.input}
                      value={member.personalizedAddy || ""}
                      onChange={(e) =>
                        updateMember(index, "personalizedAddy", e.target.value)
                      }
                    />
                  </label>

                  <label style={styles.label}>
                    RSVP
                    <input
                      style={styles.input}
                      placeholder="yes / no"
                      value={member.rsvp || ""}
                      onChange={(e) =>
                        updateMember(index, "rsvp", e.target.value || null)
                      }
                    />
                  </label>

                  <button
                    style={styles.buttonDanger}
                    onClick={() => removeMember(index)}
                    disabled={draft.members.length === 1}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div style={styles.modalButtons}>
                <button style={styles.buttonSecondary} onClick={addMember}>
                  Add member
                </button>
                <button style={styles.buttonGhost} onClick={() => setEditorOpen(false)}>
                  Cancel
                </button>
                <button style={styles.buttonPrimary} onClick={saveDraft}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===================================
// MODERN GARDEN OF EDEN STYLES
// ===================================
// These styles only change presentation.
// No application logic or data flow is changed here.
const styles = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background:
      "radial-gradient(circle at top left, #f6fff5 0%, #eff8ef 30%, #f8f4ec 65%, #f6fbf4 100%)",
    padding: "32px",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    position: "relative",
    overflow: "hidden",
    color: "#1f3b2f",
  },

  backgroundGlowOne: {
    position: "fixed",
    top: "-120px",
    left: "-80px",
    width: "360px",
    height: "360px",
    borderRadius: "999px",
    background: "radial-gradient(circle, rgba(132,204,160,0.28) 0%, rgba(132,204,160,0) 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },

  backgroundGlowTwo: {
    position: "fixed",
    bottom: "-120px",
    right: "-80px",
    width: "420px",
    height: "420px",
    borderRadius: "999px",
    background: "radial-gradient(circle, rgba(251,191,114,0.18) 0%, rgba(251,191,114,0) 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },

  loginShell: {
    position: "relative",
    zIndex: 1,
    minHeight: "calc(100vh - 64px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  loginCard: {
    width: "100%",
    maxWidth: "520px",
    background: "rgba(255,255,255,0.82)",
    backdropFilter: "blur(16px)",
    border: "1px solid rgba(169, 193, 169, 0.35)",
    padding: "32px",
    borderRadius: "28px",
    boxShadow: "0 20px 50px rgba(65, 92, 69, 0.12)",
  },

  loginBadge: {
    display: "inline-block",
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(219, 234, 213, 0.95)",
    color: "#335c44",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: "16px",
  },

  heroTitle: {
    fontSize: "38px",
    lineHeight: 1.05,
    margin: "0 0 12px 0",
    color: "#1f3b2f",
    letterSpacing: "-0.03em",
  },

  heroSubtitle: {
    margin: "0 0 24px 0",
    color: "#5f7867",
    lineHeight: 1.6,
    fontSize: "15px",
  },

  dashboardContainer: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: "none",
    margin: "0 auto",
  },

  topPanel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "20px",
    flexWrap: "wrap",
    marginBottom: "18px",
    background: "rgba(255,255,255,0.76)",
    backdropFilter: "blur(14px)",
    border: "1px solid rgba(182, 201, 183, 0.3)",
    borderRadius: "28px",
    padding: "28px",
    boxShadow: "0 18px 45px rgba(63, 89, 67, 0.08)",
  },

  topBadge: {
    display: "inline-block",
    padding: "8px 12px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #dcefd8 0%, #f2ead9 100%)",
    color: "#3f5e49",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    marginBottom: "12px",
  },

  dashboardTitle: {
    margin: "0 0 10px 0",
    fontSize: "40px",
    lineHeight: 1.05,
    letterSpacing: "-0.03em",
    color: "#1f3b2f",
  },

  dashboardSubtitle: {
    margin: 0,
    fontSize: "15px",
    lineHeight: 1.65,
    color: "#617768",
    maxWidth: "760px",
  },

  form: {
    display: "grid",
    gap: "16px",
  },

  label: {
    display: "grid",
    gap: "6px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#3f5a49",
  },

  checkboxLabel: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    fontSize: "13px",
    fontWeight: 700,
    color: "#3f5a49",
    minHeight: "46px",
  },

  input: {
    width: "100%",
    marginTop: "4px",
    padding: "13px 14px",
    borderRadius: "14px",
    border: "1px solid #d8e3d2",
    background: "rgba(255,255,255,0.94)",
    boxSizing: "border-box",
    outline: "none",
    fontSize: "14px",
    color: "#23412f",
    boxShadow: "inset 0 1px 2px rgba(33, 53, 40, 0.03)",
  },

  inputReadOnly: {
    width: "100%",
    marginTop: "4px",
    padding: "13px 14px",
    borderRadius: "14px",
    border: "1px solid #d8e3d2",
    background: "rgba(241, 245, 240, 0.95)",
    boxSizing: "border-box",
    outline: "none",
    fontSize: "14px",
    color: "#4c6453",
    boxShadow: "inset 0 1px 2px rgba(33, 53, 40, 0.03)",
  },

  searchInput: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: "16px",
    border: "1px solid #d8e3d2",
    background: "rgba(255,255,255,0.98)",
    boxSizing: "border-box",
    outline: "none",
    fontSize: "14px",
    color: "#23412f",
  },

  buttonPrimary: {
    padding: "12px 18px",
    borderRadius: "14px",
    border: "1px solid rgba(74, 124, 86, 0.1)",
    background: "linear-gradient(135deg, #6f9f73 0%, #547a57 100%)",
    color: "#fffdf8",
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 10px 24px rgba(90, 128, 96, 0.18)",
  },

  buttonPrimarySmall: {
    padding: "10px 14px",
    borderRadius: "12px",
    border: "1px solid rgba(74, 124, 86, 0.1)",
    background: "linear-gradient(135deg, #6f9f73 0%, #547a57 100%)",
    color: "#fffdf8",
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 8px 18px rgba(90, 128, 96, 0.14)",
  },

  buttonSecondary: {
    padding: "12px 18px",
    borderRadius: "14px",
    border: "1px solid #d6e3d3",
    background: "rgba(255,255,255,0.9)",
    color: "#2f4f3a",
    cursor: "pointer",
    fontWeight: 600,
  },

  buttonGhost: {
    padding: "12px 18px",
    borderRadius: "14px",
    border: "1px solid rgba(206, 214, 203, 0.9)",
    background: "rgba(249, 247, 242, 0.92)",
    color: "#4f6558",
    cursor: "pointer",
    fontWeight: 600,
  },

  buttonDanger: {
    padding: "12px 14px",
    borderRadius: "14px",
    border: "none",
    background: "linear-gradient(135deg, #c96b57 0%, #b44f42 100%)",
    color: "#fff",
    cursor: "pointer",
    height: "46px",
    alignSelf: "end",
    fontWeight: 700,
  },

  buttonDangerSmall: {
    padding: "10px 12px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #c96b57 0%, #b44f42 100%)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },

  buttonTable: {
    padding: "10px 14px",
    borderRadius: "12px",
    border: "1px solid #d7e2d5",
    background: "rgba(255,255,255,0.95)",
    color: "#2f4f3a",
    cursor: "pointer",
    fontWeight: 600,
  },

  buttonLink: {
    padding: "10px 14px",
    borderRadius: "12px",
    border: "1px solid #d7e2d5",
    background: "rgba(255,255,255,0.95)",
    color: "#2f4f3a",
    cursor: "pointer",
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  },

  headerButtons: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    alignItems: "center",
  },

  tabBar: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
    background: "rgba(255,255,255,0.76)",
    border: "1px solid rgba(185, 203, 184, 0.28)",
    borderRadius: "20px",
    padding: "8px",
    width: "fit-content",
    boxShadow: "0 12px 28px rgba(74, 97, 75, 0.06)",
  },

  tabButton: {
    padding: "11px 18px",
    borderRadius: "14px",
    border: "1px solid transparent",
    background: "transparent",
    color: "#4f6558",
    cursor: "pointer",
    fontWeight: 800,
  },

  tabButtonActive: {
    padding: "11px 18px",
    borderRadius: "14px",
    border: "1px solid #d6e3d3",
    background: "rgba(255,255,255,0.95)",
    color: "#23412f",
    cursor: "pointer",
    fontWeight: 800,
    boxShadow: "0 8px 18px rgba(86, 104, 88, 0.08)",
  },

  summaryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "18px",
    margin: "0 0 20px 0",
  },

  summaryCard: {
    position: "relative",
    overflow: "hidden",
    background: "rgba(255,255,255,0.82)",
    backdropFilter: "blur(12px)",
    padding: "24px",
    borderRadius: "24px",
    border: "1px solid rgba(185, 203, 184, 0.3)",
    boxShadow: "0 14px 36px rgba(76, 102, 77, 0.08)",
  },

  summaryAccentBar: {
    width: "64px",
    height: "6px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #6f9f73 0%, #547a57 100%)",
    marginBottom: "16px",
  },

  summaryAccentBarSoft: {
    width: "64px",
    height: "6px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #b8cfb3 0%, #8fad87 100%)",
    marginBottom: "16px",
  },

  summaryAccentBarGold: {
    width: "64px",
    height: "6px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #e7d39d 0%, #c8aa63 100%)",
    marginBottom: "16px",
  },

  summaryAccentBarRose: {
    width: "64px",
    height: "6px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #d9b6a3 0%, #b9836a 100%)",
    marginBottom: "16px",
  },

  summaryLabel: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "#708772",
    marginBottom: "10px",
  },

  summaryValue: {
    fontSize: "36px",
    fontWeight: 800,
    letterSpacing: "-0.03em",
    color: "#23412f",
    marginBottom: "8px",
    lineHeight: 1,
  },

  summaryHint: {
    fontSize: "13px",
    color: "#6a7f6f",
    lineHeight: 1.5,
    maxWidth: "260px",
  },

  toolbarCard: {
    background: "rgba(255,255,255,0.82)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(185, 203, 184, 0.28)",
    borderRadius: "24px",
    padding: "20px",
    marginBottom: "20px",
    boxShadow: "0 14px 32px rgba(77, 106, 80, 0.07)",
  },

  toolbarHeader: {
    fontSize: "14px",
    fontWeight: 700,
    color: "#46614f",
    marginBottom: "12px",
  },

  tableCard: {
    background: "rgba(255,255,255,0.84)",
    backdropFilter: "blur(12px)",
    borderRadius: "28px",
    border: "1px solid rgba(185, 203, 184, 0.3)",
    boxShadow: "0 20px 48px rgba(74, 97, 75, 0.08)",
    overflow: "hidden",
  },

  tableHeader: {
    padding: "20px 22px 14px 22px",
    borderBottom: "1px solid rgba(220, 229, 217, 0.9)",
  },

  tableTitle: {
    fontSize: "18px",
    fontWeight: 800,
    color: "#264130",
    marginBottom: "4px",
  },

  tableSubtleText: {
    fontSize: "13px",
    color: "#6c8171",
    lineHeight: 1.5,
  },

  tableWrap: {
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "1100px",
  },

  th: {
    textAlign: "left",
    padding: "14px 16px",
    borderBottom: "1px solid #e3ebe1",
    background: "rgba(240, 246, 238, 0.85)",
    color: "#4f6756",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },

  tr: {
    transition: "background 0.2s ease",
  },

  td: {
    padding: "16px",
    borderBottom: "1px solid #edf2eb",
    verticalAlign: "top",
    color: "#294332",
    fontSize: "14px",
    lineHeight: 1.55,
  },

  tdCode: {
    padding: "16px",
    borderBottom: "1px solid #edf2eb",
    verticalAlign: "top",
    color: "#23412f",
    fontSize: "14px",
    fontWeight: 800,
    letterSpacing: "0.04em",
  },

  tdUrl: {
    padding: "16px",
    borderBottom: "1px solid #edf2eb",
    verticalAlign: "top",
    color: "#5f7867",
    fontSize: "13px",
    lineHeight: 1.55,
    maxWidth: "260px",
    wordBreak: "break-word",
  },

  emptyCell: {
    padding: "28px",
    color: "#6c8171",
    fontSize: "14px",
    textAlign: "center",
  },

  error: {
    margin: "12px 0 20px 0",
    padding: "14px 16px",
    background: "rgba(251, 228, 228, 0.95)",
    color: "#8f2f2f",
    borderRadius: "16px",
    border: "1px solid rgba(226, 181, 181, 0.7)",
    boxShadow: "0 8px 20px rgba(158, 68, 68, 0.08)",
  },

  info: {
    margin: "12px 0 20px 0",
    padding: "14px 16px",
    background: "rgba(225, 244, 230, 0.95)",
    color: "#245f35",
    borderRadius: "16px",
    border: "1px solid rgba(176, 214, 183, 0.7)",
    boxShadow: "0 8px 20px rgba(70, 128, 84, 0.08)",
  },

  complete: {
    display: "inline-block",
    padding: "6px 10px",
    background: "linear-gradient(135deg, #dff2de 0%, #cfe8cc 100%)",
    color: "#24563a",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
  },

  pending: {
    display: "inline-block",
    padding: "6px 10px",
    background: "linear-gradient(135deg, #f0eadf 0%, #e8e1d2 100%)",
    color: "#6b5c3d",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
  },

  photoUploadCard: {
    display: "grid",
    gap: "18px",
    background: "rgba(255,255,255,0.84)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(185, 203, 184, 0.3)",
    borderRadius: "28px",
    padding: "22px",
    marginBottom: "20px",
    boxShadow: "0 20px 48px rgba(74, 97, 75, 0.08)",
  },

  photoUploadForm: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 1.4fr) minmax(160px, 0.7fr) minmax(220px, 1fr) auto auto",
    gap: "14px",
    alignItems: "end",
  },

  photoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "18px",
    padding: "20px",
  },

  photoCard: {
    overflow: "hidden",
    borderRadius: "22px",
    background: "rgba(255,255,255,0.94)",
    border: "1px solid rgba(221, 229, 218, 1)",
    boxShadow: "0 12px 28px rgba(86, 104, 88, 0.08)",
  },

  photoPreviewLink: {
    display: "block",
    width: "100%",
    aspectRatio: "4 / 3",
    background: "rgba(241, 245, 240, 0.95)",
    overflow: "hidden",
  },

  photoImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },

  photoMissing: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#6c8171",
    fontSize: "14px",
  },

  photoCardBody: {
    padding: "16px",
    display: "grid",
    gap: "12px",
  },

  photoCardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    alignItems: "center",
  },

  photoMetaPill: {
    display: "inline-block",
    padding: "6px 10px",
    background: "rgba(240, 246, 238, 0.9)",
    color: "#4f6756",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
  },

  photoAltText: {
    color: "#294332",
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: 1.45,
  },

  photoMetaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
  },

  photoMetaLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#7b8d7f",
    fontWeight: 800,
    marginBottom: "3px",
  },

  photoMetaValue: {
    fontSize: "13px",
    color: "#2f4f3a",
    wordBreak: "break-word",
  },

  photoIdText: {
    padding: "9px 10px",
    borderRadius: "12px",
    background: "rgba(249, 247, 242, 0.92)",
    color: "#6c8171",
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    wordBreak: "break-all",
  },

  photoButtons: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },


  selectedFilesBox: {
    gridColumn: "1 / -1",
    padding: "12px 14px",
    borderRadius: "16px",
    border: "1px solid rgba(216, 227, 210, 0.9)",
    background: "rgba(255,255,255,0.7)",
  },

  selectedFilesList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "10px",
  },

  selectedFilePill: {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "260px",
    padding: "7px 10px",
    borderRadius: "999px",
    background: "rgba(221, 235, 215, 0.95)",
    color: "#45634e",
    fontSize: "12px",
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  emptyPhotoState: {
    gridColumn: "1 / -1",
    padding: "28px",
    color: "#6c8171",
    fontSize: "14px",
    textAlign: "center",
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(36, 50, 36, 0.34)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    zIndex: 20,
  },

  modal: {
    width: "100%",
    maxWidth: "1100px",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(250,248,242,0.96) 100%)",
    borderRadius: "28px",
    padding: "26px",
    border: "1px solid rgba(196, 210, 194, 0.36)",
    boxShadow: "0 24px 60px rgba(45, 66, 49, 0.18)",
  },

  modalHeader: {
    marginBottom: "18px",
  },

  modalBadge: {
    display: "inline-block",
    padding: "7px 11px",
    borderRadius: "999px",
    background: "rgba(221, 235, 215, 0.95)",
    color: "#45634e",
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "10px",
  },

  modalTitle: {
    margin: 0,
    fontSize: "28px",
    lineHeight: 1.1,
    color: "#223c2d",
    letterSpacing: "-0.02em",
  },

  readOnlyInfoGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "18px",
    marginBottom: "18px",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "18px",
    marginBottom: "24px",
  },

  membersHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    margin: "8px 0 16px 0",
  },

  membersTitle: {
    fontSize: "18px",
    fontWeight: 800,
    color: "#264130",
    marginBottom: "4px",
  },

  membersSubtitle: {
    fontSize: "13px",
    color: "#6b7f6e",
    lineHeight: 1.5,
  },

  memberBox: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr 1fr auto",
    gap: "14px",
    padding: "16px",
    marginBottom: "14px",
    background: "rgba(255,255,255,0.88)",
    border: "1px solid rgba(221, 229, 218, 1)",
    borderRadius: "20px",
    boxShadow: "0 10px 24px rgba(86, 104, 88, 0.05)",
  },

  modalButtons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "20px",
    flexWrap: "wrap",
  },
};
