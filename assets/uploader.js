// Plan uploads for the intake forms. Files go to the founder's Google Drive through a Google
// Apps Script web app (source: structconsultpro-ops/intake-upload/Code.gs) in 4 MB pieces as soon
// as they are dropped or chosen; the form then sends the list of Drive links in the notification email.
window.SCPUpload = (function(){
  // The Apps Script web app's /exec URL. Empty: uploads stay off and the forms ask for a link.
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbz5m-hdNsjg4d-GPKtytJfXojGzjZ75sKXTWbR3OnmORzgl581Pu_duH2d2TECbvcDf/exec';
  var PART = 4 * 1024 * 1024;
  var MAX_FILES = 100, MAX_FILE = 500 * 1024 * 1024, MAX_TOTAL = 1024 * 1024 * 1024;
  var EXT = ['pdf','zip','7z','rar','dwg','dxf','dwf','dwfx','rvt','rfa','ifc','skp','nwd','nwc',
    'png','jpg','jpeg','tif','tiff','heic','webp','gif','bmp','xlsx','xls','csv','docx','doc','txt','rtf'];
  // The thank-you page reads this to say which files arrived.
  var RECEIVED_KEY = 'scp_received';

  // Plain-text body keeps the request "simple", so the browser sends it to Google without a preflight.
  // (Upload-progress events would force a preflight, which Apps Script does not answer.)
  function post(body){
    return fetch(ENDPOINT, {method:'POST', body:JSON.stringify(body)}).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(res){
        if (!r.ok || res.error){ throw new Error(res.error || ('status ' + r.status)); }
        return res;
      });
    });
  }
  function base64(blob){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = function(){ reject(new Error('could not read the file')); };
      reader.readAsDataURL(blob);
    });
  }
  function retry(fn, tries){
    return fn().catch(function(err){ if (tries <= 1){ throw err; } return retry(fn, tries - 1); });
  }
  function size(bytes){ return bytes === 0 ? '0 KB' : bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'; }
  function ext(name){ return name.split('.').pop().toLowerCase(); }
  function hasFiles(e){ return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }

  // Time per byte measured on pieces already sent; the first guess is about 10 s per 4 MB piece.
  var msPerByte = 10000 / PART;

  // onSent(bytes) reports progress. Within a piece it is estimated from the measured speed and
  // held below the piece's end until Google confirms it, so the bar moves without overpromising.
  function uploadFile(file, submission, onSent){
    return post({action:'create', submission:submission, name:file.name, size:file.size}).then(function(created){
      var offset = 0;
      function next(){
        var chunk = file.slice(offset, offset + PART);
        return base64(chunk).then(function(data){
          var started = Date.now();
          var tick = setInterval(function(){
            var guess = Math.min(0.9, (Date.now() - started) / (msPerByte * chunk.size));
            onSent(offset + Math.round(chunk.size * guess));
          }, 250);
          return retry(function(){ return post({action:'part', id:created.id, offset:offset, data:data}); }, 3)
            .then(function(res){
              clearInterval(tick);
              msPerByte = (msPerByte + (Date.now() - started) / chunk.size) / 2;
              return res;
            }, function(err){ clearInterval(tick); throw err; });
        }).then(function(res){
          offset += chunk.size;
          onSent(offset);
          return res.done ? res : next();
        });
      }
      return next();
    });
  }

  // Files from a drop, including everything inside dropped folders.
  function droppedFiles(dataTransfer){
    var items = dataTransfer.items ? Array.prototype.slice.call(dataTransfer.items) : [];
    var entries = items.map(function(it){ return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; });
    if (!entries.length || entries.some(function(e){ return !e; })){
      return Promise.resolve(Array.prototype.slice.call(dataTransfer.files));
    }
    function walk(entry){
      if (entry.isFile){ return new Promise(function(res){ entry.file(function(f){ res([f]); }, function(){ res([]); }); }); }
      var reader = entry.createReader(), all = [];
      return new Promise(function(res){
        (function read(){
          reader.readEntries(function(batch){
            if (!batch.length){ Promise.all(all.map(walk)).then(function(lists){ res([].concat.apply([], lists)); }); return; }
            all = all.concat(Array.prototype.slice.call(batch));
            read();
          }, function(){ res([]); });
        })();
      });
    }
    return Promise.all(entries.map(walk)).then(function(lists){
      // Skip system files such as .DS_Store that come along inside folders.
      return [].concat.apply([], lists).filter(function(f){ return f.name.charAt(0) !== '.'; });
    });
  }

  var api = {
    ACCEPT: EXT.map(function(e){ return '.' + e; }).join(','),
    RECEIVED_KEY: RECEIVED_KEY,

    // Resolves true only when the upload service answers, so the form can fall back to links.
    ready: function(){
      if (!ENDPOINT){ return Promise.resolve(false); }
      return fetch(ENDPOINT, {cache:'no-store'})
        .then(function(r){ return r.ok ? r.json() : {}; })
        .then(function(body){ return body.ready === true; })
        .catch(function(){ return false; });
    },

    // Turns the drop area into an instant uploader. The returned object tells the form
    // how many files it holds and resolves the email lines once every upload has finished.
    zone: function(zone, input, list){
      var submission = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      var files = [], queue = Promise.resolve(), totalBytes = 0;
      input.setAttribute('accept', api.ACCEPT);

      // One summary line under the list; it is the only part read out by screen readers.
      var summary = document.createElement('p');
      summary.className = 'upload-summary';
      summary.setAttribute('role', 'status');
      summary.innerHTML = '<span class="us-count"></span><span class="us-bytes" aria-hidden="true"></span>';
      list.parentNode.insertBefore(summary, list.nextSibling);

      function live(){ return files.filter(function(f){ return !f.removed; }); }
      function busy(){ return live().some(function(f){ return f.status === 'waiting' || f.status === 'uploading'; }); }

      function renderSummary(){
        var kept = live();
        var active = kept.filter(function(f){ return f.status !== 'error'; });
        var done = active.filter(function(f){ return f.status === 'done'; });
        var failed = kept.length - active.length;
        var sent = 0, total = 0;
        active.forEach(function(f){ sent += f.sent; total += f.file.size; });
        if (!kept.length){ summary.querySelector('.us-count').textContent = ''; summary.querySelector('.us-bytes').textContent = ''; return; }
        var count = done.length === active.length
          ? (active.length > 1 ? 'All ' + active.length + ' files uploaded' : active.length ? 'File uploaded' : 'No files uploaded')
          : 'Uploading ' + (done.length + 1) + ' of ' + active.length + (active.length === 1 ? ' file' : ' files');
        if (failed){ count += ' · ' + failed + ' need' + (failed === 1 ? 's' : '') + ' attention'; }
        summary.querySelector('.us-count').textContent = count;
        summary.querySelector('.us-bytes').textContent = total ? ' · ' + size(sent) + ' of ' + size(total) : '';
      }

      function render(item){
        var text = item.status === 'done' ? 'Uploaded' : item.status === 'error' ? 'Failed: ' + item.error
          : item.status === 'waiting' ? 'Waiting' : item.sent === 0 ? 'Starting…' : Math.min(99, Math.round(item.sent / item.file.size * 100)) + '%';
        item.el.querySelector('.uf-status').textContent = text;
        item.el.querySelector('.uf-retry').hidden = !(item.status === 'error' && item.retryable);
        item.el.className = 'uf uf-' + item.status;
        renderSummary();
      }

      function start(item){
        item.status = 'waiting';
        item.sent = 0;
        totalBytes += item.file.size;
        render(item);
        queue = queue.then(function(){
          if (item.removed){ return; }
          item.status = 'uploading';
          render(item);
          return uploadFile(item.file, submission, function(n){ item.sent = n; render(item); }).then(function(res){
            item.status = 'done';
            item.sent = item.file.size;
            item.result = res;
            render(item);
          }, function(err){
            item.status = 'error';
            item.retryable = true;
            // The client sees a plain next step; the email keeps the technical reason.
            item.error = 'Upload interrupted. Try again, or share a link.';
            item.detail = err.message;
            totalBytes -= item.file.size;
            render(item);
          });
        });
      }

      function add(picked){
        picked.forEach(function(file){
          var problem = '';
          if (EXT.indexOf(ext(file.name)) === -1){ problem = '.' + ext(file.name) + ' is not accepted. Put it in a ZIP.'; }
          else if (file.size > MAX_FILE){ problem = 'over 500 MB. Share a link for it instead.'; }
          else if (files.filter(function(f){ return !f.removed && f.status !== 'error'; }).length >= MAX_FILES){ problem = 'more than 100 files. Put the rest in a ZIP.'; }
          else if (totalBytes + file.size > MAX_TOTAL){ problem = 'over 1 GB in total. Share a link for the rest.'; }

          var li = document.createElement('li');
          li.innerHTML = '<span class="uf-name"></span><span class="uf-size"></span><span class="uf-status"></span>' +
            '<button type="button" class="uf-retry" hidden>Retry</button><button type="button" class="uf-remove">Remove</button>';
          li.querySelector('.uf-name').textContent = file.name;
          li.querySelector('.uf-size').textContent = size(file.size);
          li.querySelector('.uf-retry').setAttribute('aria-label', 'Retry ' + file.name);
          li.querySelector('.uf-remove').setAttribute('aria-label', 'Remove ' + file.name);
          list.appendChild(li);
          var item = {file:file, el:li, sent:0, status:'error', error:problem};
          files.push(item);
          li.querySelector('.uf-remove').addEventListener('click', function(){
            // Keep keyboard focus in the list: the next file's Remove, else the previous one, else the picker.
            var next = li.nextElementSibling || li.previousElementSibling;
            item.removed = true;
            if (item.status !== 'error'){ totalBytes -= file.size; }
            li.remove();
            renderSummary();
            (next ? next.querySelector('.uf-remove') : input).focus();
          });
          li.querySelector('.uf-retry').addEventListener('click', function(){
            item.retryable = false;
            start(item);
            li.querySelector('.uf-remove').focus();
          });
          if (problem){ render(item); return; }
          start(item);
        });
      }

      input.addEventListener('change', function(){
        add(Array.prototype.slice.call(input.files));
        input.value = '';
      });
      ['dragenter', 'dragover'].forEach(function(type){
        zone.addEventListener(type, function(e){ e.preventDefault(); zone.classList.add('is-over'); });
      });
      ['dragleave', 'drop'].forEach(function(type){
        zone.addEventListener(type, function(e){ e.preventDefault(); zone.classList.remove('is-over'); });
      });
      zone.addEventListener('drop', function(e){ e.stopPropagation(); droppedFiles(e.dataTransfer).then(add); });

      // A file dropped anywhere else on the page would make the browser open it and lose the form.
      // Catch it and treat it as a drop on the upload area.
      window.addEventListener('dragover', function(e){ if (hasFiles(e)){ e.preventDefault(); } });
      window.addEventListener('drop', function(e){
        if (!hasFiles(e)){ return; }
        e.preventDefault();
        droppedFiles(e.dataTransfer).then(function(picked){
          add(picked);
          zone.scrollIntoView({block:'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
        });
      });

      // Leaving the page while files are still going up would lose them; the browser asks first.
      window.addEventListener('beforeunload', function(e){
        if (!busy()){ return; }
        e.preventDefault();
        e.returnValue = '';
      });

      return {
        count: function(){ return files.filter(function(f){ return !f.removed && f.status !== 'error'; }).length; },
        // Waits for uploads still running, then returns one line per stored file. Files that
        // could not be stored don't hold up the rest; the email names them so nothing goes unnoticed.
        finish: function(){
          return queue.then(function(){
            var kept = live();
            var done = kept.filter(function(f){ return f.status === 'done'; });
            var lines = done.map(function(f){
              return f.file.name + ' (' + size(f.file.size) + ')\n' + f.result.url;
            });
            kept.filter(function(f){ return f.status === 'error'; }).forEach(function(f){
              lines.push('NOT UPLOADED: ' + f.file.name + ' (' + (f.detail || f.error) + ')');
            });
            try {
              if (done.length){
                sessionStorage.setItem(RECEIVED_KEY, JSON.stringify(done.map(function(f){ return {name:f.file.name, size:f.file.size}; })));
              } else {
                sessionStorage.removeItem(RECEIVED_KEY);
              }
            } catch (e) {}
            return lines;
          });
        }
      };
    }
  };
  return api;
})();
