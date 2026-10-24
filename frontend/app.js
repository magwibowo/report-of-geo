var API_URL = '/api/reports';

// ===== Toast: notifikasi mengambang yang hilang otomatis =====
var toastContainer = document.getElementById('toast-container');

function showToast(text, type) {
  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');
  toast.textContent = text;
  toastContainer.appendChild(toast);

  requestAnimationFrame(function () {
    toast.classList.add('show');
  });

  setTimeout(function () {
    toast.classList.remove('show');
    setTimeout(function () {
      toast.remove();
    }, 200);
  }, 3000);
}

// ===== Peta dasar =====
var map = L.map('map').setView([-7.9797, 112.6304], 14);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Layer marker laporan, dengan clustering
var reportsLayer = L.markerClusterGroup({
  maxClusterRadius: 50,
  showCoverageOnHover: false
});
map.addLayer(reportsLayer);

// Layer poligon zona rawan
var zonesLayer = L.layerGroup().addTo(map);

// Mode saat ini: 'lapor' (klik menandai lokasi) atau 'lihat' (klik membuka popup)
var currentMode = 'lapor';

// Mencegah teks dari pengguna dibaca sebagai HTML (XSS)
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text == null ? '' : text;
  return div.innerHTML;
}

// ===== Warna per kategori laporan dan per level zona =====
var CATEGORY_COLORS = {
  jalan: '#e67e22',
  penerangan: '#f1c40f',
  kebersihan: '#27ae60',
  drainase: '#2980b9',
  lainnya: '#7f8c8d'
};

var ZONE_COLORS = {
  rawan_banjir: '#2980b9',
  rawan_macet: '#c0392b',
  rawan_sampah: '#27ae60',
  rawan_lainnya: '#e67e22'
};

function getCategoryFilter() {
  return document.getElementById('filter-category').value;
}

// ===== Mode admin (JWT) =====
var STATUSES = ['pending', 'diproses', 'selesai'];
var adminToken = localStorage.getItem('geoReportToken') || '';
var adminUsername = localStorage.getItem('geoReportUsername') || '';

function buildPopup(props) {
  var html = '<strong>' + escapeHtml(props.title) + '</strong><br>';
  html += '<em>' + escapeHtml(props.category) + ' - ' + escapeHtml(props.status) + '</em><br>';
  if (props.description) {
    html += escapeHtml(props.description) + '<br>';
  }
  if (props.photo_url) {
    html += '<img class="popup-photo" src="' + encodeURI(props.photo_url) + '" alt="Foto laporan">';
  }
  if (props.distance !== undefined) {
    html += 'Jarak: ' + props.distance + ' m<br>';
  }
  html += '<small>' + new Date(props.created_at).toLocaleString('id-ID') + '</small><br>';

  if (props.zone_name) {
    html += '<span style="color:#d35400;">&#9888; Berada di ' + escapeHtml(props.zone_name) + '</span><br>';
  }

  if (adminToken) {
    html += '<div class="admin-actions">';
    html += '<select class="status-select">';
    STATUSES.forEach(function (s) {
      html += '<option value="' + s + '"' + (s === props.status ? ' selected' : '') + '>' + s + '</option>';
    });
    html += '</select> ';
    html += '<button type="button" class="btn-status" data-id="' + props.id + '">Simpan</button> ';
    html += '<button type="button" class="btn-delete" data-id="' + props.id + '">Hapus</button>';
    html += '</div>';
  }
  return html;
}

function buildZonePopup(p) {
  var html = '<strong>' + escapeHtml(p.name) + '</strong><br>';
  html += '<em>' + escapeHtml(p.level) + '</em><br>';
  if (p.description) {
    html += escapeHtml(p.description) + '<br>';
  }
  if (adminToken) {
    html += '<div class="admin-actions">';
    html += '<button type="button" class="btn-zone-delete" data-id="' + p.id + '">Hapus Zona</button>';
    html += '</div>';
  }
  return html;
}

// ===== Heatmap kepadatan laporan =====
var heatLayer = L.heatLayer([], { radius: 25, blur: 20, maxZoom: 17 });
var heatmapActive = false;

function updateHeatmap(geojson) {
  if (!heatmapActive) return;
  var points = geojson.features.map(function (f) {
    return [f.geometry.coordinates[1], f.geometry.coordinates[0]];
  });
  heatLayer.setLatLngs(points);
}

// Menggambar sekumpulan Feature laporan ke peta
function drawReports(geojson) {
  reportsLayer.clearLayers();
  L.geoJSON(geojson, {
    pointToLayer: function (feature, latlng) {
      var color = CATEGORY_COLORS[feature.properties.category] || '#7f8c8d';
      return L.circleMarker(latlng, {
        radius: 9,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
        bubblingMouseEvents: false
      });
    },
    onEachFeature: function (feature, layer) {
      if (currentMode === 'lihat') {
        layer.bindPopup(buildPopup(feature.properties));
      } else {
        // Mode Lapor: klik marker laporan lain tetap menandai lokasi baru, bukan buka popup
        layer.on('click', function (e) {
          setSelectedLocation(e.latlng);
        });
      }
    }
  }).addTo(reportsLayer);

  updateHeatmap(geojson);
}

// ===== Bounding box loading: hanya memuat laporan pada area peta yang terlihat =====
var VIEW_LOAD_ENABLED = true; // dimatikan sementara saat filter radius/terdekat aktif

function loadReports() {
  if (!VIEW_LOAD_ENABLED) return;

  var bounds = map.getBounds();
  var category = getCategoryFilter();

  var url = API_URL + '/in-view' +
    '?minLng=' + bounds.getWest() +
    '&minLat=' + bounds.getSouth() +
    '&maxLng=' + bounds.getEast() +
    '&maxLat=' + bounds.getNorth();

  if (category) {
    url += '&category=' + encodeURIComponent(category);
  }

  fetch(url)
    .then(function (res) { return res.json(); })
    .then(drawReports)
    .catch(function (err) {
      console.error('Gagal memuat laporan:', err);
    });
}

// ===== Zona rawan =====
function loadZones() {
  fetch('/api/zones')
    .then(function (res) { return res.json(); })
    .then(function (geojson) {
      zonesLayer.clearLayers();
      L.geoJSON(geojson, {
        style: function (feature) {
          var color = ZONE_COLORS[feature.properties.level] || '#7f8c8d';
          return { color: color, weight: 2, fillColor: color, fillOpacity: 0.18 };
        },
        onEachFeature: function (feature, layer) {
          var p = feature.properties;
          layer.bindTooltip(escapeHtml(p.name), { sticky: true });

          if (currentMode === 'lihat') {
            layer.bindPopup(buildZonePopup(p));
          } else {
            // Mode Lapor: klik di dalam zona tetap menandai lokasi laporan baru
            layer.on('click', function (e) {
              setSelectedLocation(e.latlng);
            });
          }
        }
      }).addTo(zonesLayer);
    })
    .catch(function (err) {
      console.error('Gagal memuat zona:', err);
    });
}

// ===== Pilih lokasi dengan klik peta (hanya Mode Lapor) =====
var selectedMarker = null;

function setSelectedLocation(latlng) {
  if (selectedMarker) {
    selectedMarker.setLatLng(latlng);
  } else {
    selectedMarker = L.circleMarker(latlng, {
      radius: 10,
      color: '#8e44ad',
      fillColor: '#9b59b6',
      fillOpacity: 0.7
    }).addTo(map);
  }
  document.getElementById('lat').value = latlng.lat.toFixed(6);
  document.getElementById('lng').value = latlng.lng.toFixed(6);

  reverseGeocode(latlng.lat, latlng.lng);
}

map.on('click', function (e) {
  if (currentMode === 'lapor') {
    setSelectedLocation(e.latlng);
  }
});

// ===== Kirim formulir ke API (multipart/form-data, foto opsional) =====
var form = document.getElementById('report-form');

form.addEventListener('submit', function (e) {
  e.preventDefault();

  var lat = document.getElementById('lat').value;
  var lng = document.getElementById('lng').value;

  if (!lat || !lng) {
    showToast('Klik peta dulu untuk menentukan lokasi.', 'error');
    return;
  }

  var formData = new FormData();
  formData.append('title', document.getElementById('title').value);
  formData.append('category', document.getElementById('category').value);
  formData.append('description', document.getElementById('description').value);
  formData.append('lat', lat);
  formData.append('lng', lng);

  var photo = document.getElementById('photo').files[0];
  if (photo) {
    if (photo.size > 2 * 1024 * 1024) {
      showToast('Ukuran foto maksimal 2 MB.', 'error');
      return;
    }
    formData.append('photo', photo);
  }

  fetch(API_URL, {
    method: 'POST',
    body: formData
  })
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function (result) {
      if (!result.ok) {
        showToast(result.data.message || 'Gagal menyimpan laporan.', 'error');
        return;
      }
      showToast('Laporan berhasil dikirim.', 'success');
      addMyReportId(result.data.properties.id);
      loadMyReports();
      form.reset();
      if (selectedMarker) {
        map.removeLayer(selectedMarker);
        selectedMarker = null;
      }
      resetFilter();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Tidak dapat terhubung ke server.', 'error');
    });
});

// ===== Filter radius =====
var radiusInput = document.getElementById('radius');
var radiusLabel = document.getElementById('radius-label');
var filterInfo = document.getElementById('filter-info');
var resultList = document.getElementById('result-list');
var radiusCircle = null;

radiusInput.addEventListener('input', function () {
  radiusLabel.textContent = radiusInput.value;
});

function renderList(features) {
  resultList.innerHTML = '';
  features.forEach(function (f) {
    var li = document.createElement('li');
    var text = f.properties.title;
    if (f.properties.distance !== undefined) {
      text += ' (' + f.properties.distance + ' m)';
    }
    li.textContent = text;
    resultList.appendChild(li);
  });
}

function searchNearby() {
  var lat = document.getElementById('lat').value;
  var lng = document.getElementById('lng').value;
  var radius = radiusInput.value;

  if (!lat || !lng) {
    filterInfo.textContent = 'Klik peta dulu untuk menentukan titik pusat.';
    return;
  }

  var url = API_URL + '/nearby?lat=' + lat + '&lng=' + lng + '&radius=' + radius;
  var category = getCategoryFilter();
  if (category) {
    url += '&category=' + encodeURIComponent(category);
  }

  fetch(url)
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function (result) {
      if (!result.ok) {
        filterInfo.textContent = result.data.message || 'Gagal mencari laporan.';
        return;
      }

      var geojson = result.data;
      VIEW_LOAD_ENABLED = false;
      drawReports(geojson);

      if (radiusCircle) {
        map.removeLayer(radiusCircle);
      }
      radiusCircle = L.circle([Number(lat), Number(lng)], {
        radius: Number(radius),
        color: '#2980b9',
        fillOpacity: 0.08,
        interactive: false
      }).addTo(map);
      map.fitBounds(radiusCircle.getBounds());

      filterInfo.textContent = geojson.features.length + ' laporan dalam radius ' + radius + ' m.';
      renderList(geojson.features);
    })
    .catch(function (err) {
      console.error(err);
      filterInfo.textContent = 'Tidak dapat terhubung ke server.';
    });
}

function resetFilter() {
  VIEW_LOAD_ENABLED = true;
  document.getElementById('filter-category').value = '';

  if (radiusCircle) {
    map.removeLayer(radiusCircle);
    radiusCircle = null;
  }
  filterInfo.textContent = '';
  resultList.innerHTML = '';
  loadReports();
}

document.getElementById('btn-search').addEventListener('click', searchNearby);
document.getElementById('btn-reset').addEventListener('click', resetFilter);

document.getElementById('filter-category').addEventListener('change', function () {
  if (radiusCircle) {
    searchNearby();
  } else {
    loadReports();
  }
});

// ===== Cari N laporan terdekat (KNN) =====
function searchClosest() {
  var lat = document.getElementById('lat').value;
  var lng = document.getElementById('lng').value;
  var limit = document.getElementById('closest-limit').value;

  if (!lat || !lng) {
    filterInfo.textContent = 'Klik peta dulu untuk menentukan titik acuan.';
    return;
  }

  var url = API_URL + '/closest?lat=' + lat + '&lng=' + lng + '&limit=' + limit;
  var category = getCategoryFilter();
  if (category) {
    url += '&category=' + encodeURIComponent(category);
  }

  fetch(url)
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function (result) {
      if (!result.ok) {
        filterInfo.textContent = result.data.message || 'Gagal mencari laporan terdekat.';
        return;
      }

      var geojson = result.data;
      VIEW_LOAD_ENABLED = false;

      if (radiusCircle) {
        map.removeLayer(radiusCircle);
        radiusCircle = null;
      }

      drawReports(geojson);

      if (geojson.features.length > 0) {
        var points = geojson.features.map(function (f) {
          return [f.geometry.coordinates[1], f.geometry.coordinates[0]];
        });
        points.push([Number(lat), Number(lng)]);
        map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
      }

      filterInfo.textContent = geojson.features.length + ' laporan terdekat dari titik yang dipilih.';
      renderList(geojson.features);
    })
    .catch(function (err) {
      console.error(err);
      filterInfo.textContent = 'Tidak dapat terhubung ke server.';
    });
}

document.getElementById('btn-closest').addEventListener('click', searchClosest);

// ===== Mode admin: ubah status dan hapus laporan, hapus zona =====
function refreshView() {
  if (radiusCircle) {
    searchNearby();
  } else {
    loadReports();
  }
}

function adminRequest(url, method, body) {
  var options = {
    method: method,
    headers: { 'Authorization': 'Bearer ' + adminToken }
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(url, options).then(function (res) {
    return res.json().then(function (data) {
      if (res.status === 401) {
        adminToken = '';
        adminUsername = '';
        localStorage.removeItem('geoReportToken');
        localStorage.removeItem('geoReportUsername');
        applyAuthUI();
        showToast('Sesi login berakhir, silakan login lagi.', 'error');
      }
      return { ok: res.ok, data: data };
    });
  });
}

function updateStatus(id, status) {
  adminRequest(API_URL + '/' + id + '/status', 'PATCH', { status: status })
    .then(function (result) {
      if (!result.ok) {
        showToast(result.data.message || 'Gagal mengubah status.', 'error');
        return;
      }
      map.closePopup();
      showToast('Status laporan diperbarui.', 'success');
      refreshView();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Tidak dapat terhubung ke server.', 'error');
    });
}

function deleteReport(id) {
  adminRequest(API_URL + '/' + id, 'DELETE')
    .then(function (result) {
      if (!result.ok) {
        showToast(result.data.message || 'Gagal menghapus laporan.', 'error');
        return;
      }
      map.closePopup();
      showToast('Laporan dihapus.', 'success');
      refreshView();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Tidak dapat terhubung ke server.', 'error');
    });
}

function deleteZone(id) {
  adminRequest('/api/zones/' + id, 'DELETE')
    .then(function (result) {
      if (!result.ok) {
        showToast(result.data.message || 'Gagal menghapus zona.', 'error');
        return;
      }
      map.closePopup();
      showToast('Zona dihapus.', 'success');
      loadZones();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Tidak dapat terhubung ke server.', 'error');
    });
}

map.on('popupopen', function (e) {
  var el = e.popup.getElement();
  var statusBtn = el.querySelector('.btn-status');
  var deleteBtn = el.querySelector('.btn-delete');
  var zoneDeleteBtn = el.querySelector('.btn-zone-delete');

  if (statusBtn) {
    statusBtn.addEventListener('click', function () {
      var status = el.querySelector('.status-select').value;
      updateStatus(statusBtn.getAttribute('data-id'), status);
    });
  }
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function () {
      if (confirm('Hapus laporan ini secara permanen?')) {
        deleteReport(deleteBtn.getAttribute('data-id'));
      }
    });
  }
  if (zoneDeleteBtn) {
    zoneDeleteBtn.addEventListener('click', function () {
      if (confirm('Hapus zona ini secara permanen?')) {
        deleteZone(zoneDeleteBtn.getAttribute('data-id'));
      }
    });
  }
});

// ===== Login / logout (JWT) =====
var loginForm = document.getElementById('login-form');
var btnLogout = document.getElementById('btn-logout');
var adminInfo = document.getElementById('admin-info');

function applyAuthUI() {
  if (adminToken) {
    loginForm.style.display = 'none';
    btnLogout.style.display = 'block';
    adminInfo.textContent = 'Login sebagai ' + adminUsername + '.';
  } else {
    loginForm.style.display = 'block';
    btnLogout.style.display = 'none';
    adminInfo.textContent = '';
  }
  updateZoneEditorVisibility();
}

loginForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var username = document.getElementById('admin-username').value.trim();
  var password = document.getElementById('admin-password').value;

  if (!username || !password) {
    showToast('Isi username dan password.', 'error');
    return;
  }

  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: password })
  })
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function (result) {
      if (!result.ok) {
        showToast(result.data.message || 'Login gagal.', 'error');
        return;
      }
      adminToken = result.data.token;
      adminUsername = result.data.username;
      localStorage.setItem('geoReportToken', adminToken);
      localStorage.setItem('geoReportUsername', adminUsername);
      loginForm.reset();
      showToast('Login berhasil.', 'success');
      applyAuthUI();
      refreshView();
      loadZones();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Tidak dapat terhubung ke server.', 'error');
    });
});

btnLogout.addEventListener('click', function () {
  adminToken = '';
  adminUsername = '';
  localStorage.removeItem('geoReportToken');
  localStorage.removeItem('geoReportUsername');
  showToast('Logout berhasil.', 'info');
  applyAuthUI();
  refreshView();
  loadZones();
});

// ===== Toggle Mode Lapor / Mode Lihat =====
var btnModeLapor = document.getElementById('btn-mode-lapor');
var btnModeLihat = document.getElementById('btn-mode-lihat');

function setMode(mode) {
  currentMode = mode;

  if (mode === 'lapor') {
    btnModeLapor.classList.add('mode-active');
    btnModeLihat.classList.remove('mode-active');
    showToast('Mode Lapor aktif: klik peta untuk menandai laporan.', 'info');
  } else {
    btnModeLapor.classList.remove('mode-active');
    btnModeLihat.classList.add('mode-active');
    showToast('Mode Lihat aktif: klik laporan atau zona untuk detail.', 'info');
  }

  refreshView();
  loadZones();
  updateZoneEditorVisibility();
}

btnModeLapor.addEventListener('click', function () { setMode('lapor'); });
btnModeLihat.addEventListener('click', function () { setMode('lihat'); });

// ===== CRUD Zona: menggambar poligon baru (khusus Mode Lihat + mode admin) =====
var drawnItems = new L.FeatureGroup().addTo(map);
var drawControl = new L.Control.Draw({
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: '#e67e22' }
    },
    marker: false,
    circle: false,
    circlemarker: false,
    rectangle: false,
    polyline: false
  },
  edit: false
});

var zoneEditor = document.getElementById('zone-editor');
var btnDrawZone = document.getElementById('btn-draw-zone');
var zoneForm = document.getElementById('zone-form');
var pendingZoneLayer = null;

function updateZoneEditorVisibility() {
  var shouldShow = currentMode === 'lihat' && !!adminToken;
  zoneEditor.style.display = shouldShow ? 'block' : 'none';
  if (!shouldShow && drawControl._map) {
    map.removeControl(drawControl);
  }
}

btnDrawZone.addEventListener('click', function () {
  map.addControl(drawControl);
  showToast('Klik titik-titik sudut poligon di peta, lalu klik titik pertama untuk menutup.', 'info');
});

map.on(L.Draw.Event.CREATED, function (e) {
  pendingZoneLayer = e.layer;
  drawnItems.addLayer(pendingZoneLayer);
  map.removeControl(drawControl);
  zoneForm.style.display = 'block';
});

zoneForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (!pendingZoneLayer) return;

  var body = {
    name: document.getElementById('zone-name').value,
    level: document.getElementById('zone-level').value,
    description: document.getElementById('zone-description').value,
    geometry: pendingZoneLayer.toGeoJSON().geometry
  };

  adminRequest('/api/zones', 'POST', body)
    .then(function (result) {
      if (!result.ok) {
        showToast(result.data.message || 'Gagal menyimpan zona.', 'error');
        return;
      }
      showToast('Zona berhasil disimpan.', 'success');
      drawnItems.removeLayer(pendingZoneLayer);
      pendingZoneLayer = null;
      zoneForm.reset();
      zoneForm.style.display = 'none';
      loadZones();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Tidak dapat terhubung ke server.', 'error');
    });
});

document.getElementById('btn-cancel-zone').addEventListener('click', function () {
  if (pendingZoneLayer) {
    drawnItems.removeLayer(pendingZoneLayer);
    pendingZoneLayer = null;
  }
  zoneForm.reset();
  zoneForm.style.display = 'none';
  if (drawControl._map) {
    map.removeControl(drawControl);
  }
});

// ===== Legenda warna kategori =====
var legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
  var div = L.DomUtil.create('div', 'legend');
  var html = '';
  Object.keys(CATEGORY_COLORS).forEach(function (key) {
    html += '<div><span class="dot" style="background:' + CATEGORY_COLORS[key] + '"></span>' + key + '</div>';
  });
  div.innerHTML = html;
  return div;
};
legend.addTo(map);

// ===== Muat ulang otomatis saat peta digeser/zoom (debounce 300ms) =====
var moveTimer = null;
map.on('moveend zoomend', function () {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(loadReports, 300);
});

// ===== Lokasi terkini via GPS =====
document.getElementById('btn-gps').addEventListener('click', function () {
  if (!navigator.geolocation) {
    showToast('Perangkat ini tidak mendukung GPS.', 'error');
    return;
  }

  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Mencari lokasi...';

  navigator.geolocation.getCurrentPosition(
    function (position) {
      var latlng = L.latLng(position.coords.latitude, position.coords.longitude);
      setSelectedLocation(latlng);
      map.setView(latlng, 16);

      showToast('Lokasi ditemukan.', 'success');
      btn.disabled = false;
      btn.textContent = 'Gunakan Lokasi Saya';
    },
    function (err) {
      var msg = 'Gagal mengambil lokasi.';
      if (err.code === err.PERMISSION_DENIED) {
        msg = 'Izin lokasi ditolak. Aktifkan izin lokasi di browser.';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        msg = 'Lokasi tidak tersedia saat ini.';
      } else if (err.code === err.TIMEOUT) {
        msg = 'Waktu pencarian lokasi habis, coba lagi.';
      }
      showToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = 'Gunakan Lokasi Saya';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ===== Reverse geocoding: koordinat -> nama jalan/kelurahan =====
var geocodeResult = document.getElementById('geocode-result');
var geocodeRequestId = 0;

function reverseGeocode(lat, lng) {
  geocodeResult.textContent = 'Mencari nama lokasi...';

  var thisRequestId = ++geocodeRequestId;

  fetch('/api/geocode/reverse?lat=' + lat + '&lng=' + lng)
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (thisRequestId !== geocodeRequestId) return;

      if (data.road) {
        var text = data.road;
        if (data.village) text += ', ' + data.village;
        geocodeResult.textContent = text;
      } else if (data.display_name) {
        geocodeResult.textContent = data.display_name;
      } else {
        geocodeResult.textContent = 'Nama lokasi tidak ditemukan.';
      }
    })
    .catch(function (err) {
      if (thisRequestId !== geocodeRequestId) return;
      console.error('Gagal reverse geocoding:', err);
      geocodeResult.textContent = '';
    });
}

// ===== Riwayat laporan saya (localStorage) =====
var MY_REPORTS_KEY = 'geoReportMyReports';
var myReportsList = document.getElementById('my-reports-list');

function getMyReportIds() {
  try {
    var raw = localStorage.getItem(MY_REPORTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function addMyReportId(id) {
  var ids = getMyReportIds();
  ids.unshift(id);
  if (ids.length > 50) ids = ids.slice(0, 50);
  localStorage.setItem(MY_REPORTS_KEY, JSON.stringify(ids));
}

function loadMyReports() {
  var ids = getMyReportIds();
  myReportsList.innerHTML = '';

  if (ids.length === 0) {
    var empty = document.createElement('li');
    empty.textContent = 'Belum ada laporan yang kamu kirim dari perangkat ini.';
    empty.style.cursor = 'default';
    myReportsList.appendChild(empty);
    return;
  }

  ids.forEach(function (id) {
    fetch(API_URL + '/' + id)
      .then(function (res) {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(function (feature) {
        var li = document.createElement('li');
        li.textContent = feature.properties.title + ' (' + feature.properties.status + ')';
        li.style.cursor = 'pointer';
        li.addEventListener('click', function () {
          var coords = feature.geometry.coordinates;
          map.setView([coords[1], coords[0]], 17);
          setMode('lihat');
        });
        myReportsList.appendChild(li);
      })
      .catch(function () {
        // Laporan mungkin sudah dihapus admin, lewati saja
      });
  });
}

// ===== Dashboard statistik =====
function renderBarChart(container, rows, labelKey) {
  container.innerHTML = '';
  if (rows.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400">Belum ada data.</p>';
    return;
  }

  var max = Math.max.apply(null, rows.map(function (r) { return r.total; }));

  rows.forEach(function (row) {
    var pct = max > 0 ? Math.round((row.total / max) * 100) : 0;

    var rowEl = document.createElement('div');
    rowEl.className = 'bar-row';

    var label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = row[labelKey];

    var track = document.createElement('div');
    track.className = 'bar-track';
    var fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = pct + '%';
    track.appendChild(fill);

    var count = document.createElement('div');
    count.className = 'bar-count';
    count.textContent = row.total;

    rowEl.appendChild(label);
    rowEl.appendChild(track);
    rowEl.appendChild(count);
    container.appendChild(rowEl);
  });
}

function loadDashboard() {
  fetch(API_URL + '/stats')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      document.getElementById('dashboard-total').textContent =
        'Total laporan: ' + data.total;
      renderBarChart(document.getElementById('chart-category'), data.byCategory, 'category');
      renderBarChart(document.getElementById('chart-status'), data.byStatus, 'status');
    })
    .catch(function (err) {
      console.error('Gagal memuat statistik:', err);
    });
}

// ===== Dark mode (Tailwind class strategy) =====
var THEME_KEY = 'geoReportTheme';
var btnTheme = document.getElementById('btn-theme');

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    btnTheme.innerHTML = '<i class="ph ph-sun"></i>';
  } else {
    document.documentElement.classList.remove('dark');
    btnTheme.innerHTML = '<i class="ph ph-moon"></i>';
  }
}

btnTheme.addEventListener('click', function () {
  var current = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  var next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

applyTheme(localStorage.getItem(THEME_KEY) || 'light');

// ===== Mobile: tombol buka/tutup panel (Tailwind translate classes) =====
var btnPanelToggle = document.getElementById('btn-panel-toggle');
var panelEl = document.getElementById('panel');
var panelOverlay = document.getElementById('panel-overlay');

btnPanelToggle.addEventListener('click', function () {
  panelEl.classList.toggle('panel-open');
  panelOverlay.classList.toggle('show');
});

panelOverlay.addEventListener('click', function () {
  panelEl.classList.remove('panel-open');
  panelOverlay.classList.remove('show');
});

// ===== Modal: Dashboard Statistik & Mode Admin =====
function openModal(modalId) {
  var modal = document.getElementById(modalId);
  if (!modal) return;

  modal.classList.add('show');
  setTimeout(function () {
    modal.classList.add('open');
  }, 10);
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');

  setTimeout(function () {
    modal.classList.remove('show');
  }, 300);
}

document.getElementById('btn-open-dashboard').addEventListener('click', function () {
  openModal('modal-dashboard');
  loadDashboard();
});

document.getElementById('btn-open-admin').addEventListener('click', function () {
  openModal('modal-admin');
});

document.querySelectorAll('.btn-close-modal').forEach(function (btn) {
  btn.addEventListener('click', function (e) {
    var modal = e.target.closest('.modal-overlay');
    closeModal(modal);
  });
});

document.querySelectorAll('#modal-dashboard, #modal-admin').forEach(function (modal) {
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal(modal);
  });
});

// ===== PWA: daftarkan service worker =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      console.error('Gagal mendaftarkan service worker:', err);
    });
  });
}

// ===== Muat data awal =====
loadReports();
loadZones();
applyAuthUI();
loadMyReports();