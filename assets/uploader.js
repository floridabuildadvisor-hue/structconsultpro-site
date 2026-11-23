// Plan uploads for the intake forms (see functions/api/upload.js). Files go to private
// Cloudflare R2 storage in 10 MB parts as soon as they are dropped or chosen; the form then
// sends only the list of stored files, with download links, in the notification email.
window.SCPUpload = (function(){
  var API = '/api/upload';
  var PART = 10 * 1024 * 1024;
  var MAX_FILES = 100, MAX_FILE = 1024 * 1024 * 1024, MAX_TOTAL = 2 * 1024 * 1024 * 1024;
  var EXT = ['pdf','zip','7z','rar','dwg','dxf','dwf','dwfx','rvt','rfa','ifc','skp','nwd','nwc',
    'png','jpg','jpeg','tif','tiff','heic','webp','gif','bmp','xlsx','xls','csv','docx','doc','txt','rtf'];

  function call(action, options, query){
    return fetch(API + '?action=' + action + (query || ''), options).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(body){
        if (!r.ok){ throw new Error(body.error || ('status ' + r.status)); }
        return body;
      });
    });
  }
  function post(action, body){
    return call(action, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
  }
  function retry(fn, tries){
    return fn().catch(function(err){ if (tries <= 1){ throw err; } return retry(fn, tries - 1); });
  }
  function size(bytes){ return bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'; }
  function ext(name){ return name.split('.').pop().toLowerCase(); }

  function uploadFile(file, submission, onBytes){
    return post('create', {submission:submission, name:file.name, size:file.size}).then(function(created){
      var parts = [], offset = 0, number = 1;
      function next(){
        if (offset >= file.size){
          return post('complete', {key:created.key, uploadId:created.uploadId, parts:parts});
        }
        var chunk = file.slice(offset, offset + PART), partNumber = number;
        var query = '&key=' + encodeURIComponent(created.key) + '&uploadId=' + encodeURIComponent(created.uploadId) + '&part=' + partNumber;
        return retry(function(){ return call('part', {method:'PUT', body:chunk}, query); }, 3).then(function(done){
          parts.push({partNumber:done.partNumber, etag:done.etag});
          offset += chunk.size;
          number += 1;
          onBytes(chunk.size);
          return next();
        });
      }
      return next().catch(function(err){
        post('abort', {key:created.key, uploadId:created.uploadId}).catch(function(){});
        throw err;
      });
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

    // Resolves true only when the site's storage is connected, so the form can fall back to links.
    ready: function(){
      return fetch(API + '?action=status', {cache:'no-store'})
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

      function render(item){
        var pct = item.status === 'done' ? 'Uploaded' : item.status === 'error' ? 'Failed: ' + item.error
          : item.status === 'waiting' ? 'Waiting' : Math.min(99, Math.round(item.sent / item.file.size * 100)) + '%';
        item.el.querySelector('.uf-status').textContent = pct;
        item.el.className = 'uf uf-' + item.status;
      }

      function add(picked){
        picked.forEach(function(file){
          var problem = '';
          if (EXT.indexOf(ext(file.name)) === -1){ problem = '.' + ext(file.name) + ' is not accepted. Put it in a ZIP.'; }
          else if (file.size > MAX_FILE){ problem = 'over 1 GB. Share a link for it instead.'; }
          else if (files.filter(function(f){ return !f.removed && f.status !== 'error'; }).length >= MAX_FILES){ problem = 'more than 100 files. Put the rest in a ZIP.'; }
          else if (totalBytes + file.size > MAX_TOTAL){ problem = 'over 2 GB in total. Share a link for the rest.'; }

          var li = document.createElement('li');
          li.innerHTML = '<span class="uf-name"></span><span class="uf-size"></span><span class="uf-status" aria-live="polite"></span><button type="button" class="uf-remove">Remove</button>';
          li.querySelector('.uf-name').textContent = file.name;
          li.querySelector('.uf-size').textContent = size(file.size);
          li.querySelector('.uf-remove').setAttribute('aria-label', 'Remove ' + file.name);
          list.appendChild(li);
          var item = {file:file, el:li, sent:0, status: problem ? 'error' : 'waiting', error: problem};
          files.push(item);
          li.querySelector('.uf-remove').addEventListener('click', function(){
            item.removed = true;
            if (item.status !== 'error'){ totalBytes -= file.size; }
            li.remove();
          });
          render(item);
          if (problem){ return; }
          totalBytes += file.size;
          queue = queue.then(function(){
            if (item.removed){ return; }
            item.status = 'uploading';
            render(item);
            return uploadFile(file, submission, function(n){ item.sent += n; render(item); }).then(function(res){
              item.status = 'done';
              item.result = res;
              render(item);
            }, function(err){
              item.status = 'error';
              item.error = err.message;
              totalBytes -= file.size;
              render(item);
            });
          });
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
      zone.addEventListener('drop', function(e){ droppedFiles(e.dataTransfer).then(add); });

      return {
        count: function(){ return files.filter(function(f){ return !f.removed && f.status !== 'error'; }).length; },
        // Waits for uploads still running, then returns one line per stored file. Files that
        // could not be stored don't hold up the rest; the email names them so nothing goes unnoticed.
        finish: function(){
          return queue.then(function(){
            var kept = files.filter(function(f){ return !f.removed; });
            var lines = kept.filter(function(f){ return f.status === 'done'; }).map(function(f){
              return f.file.name + ' (' + size(f.file.size) + ')\n' + (f.result.url || f.result.key);
            });
            kept.filter(function(f){ return f.status === 'error'; }).forEach(function(f){
              lines.push('NOT UPLOADED: ' + f.file.name + ' (' + f.error + ')');
            });
            return lines;
          });
        }
      };
    }
  };
  return api;
})();
