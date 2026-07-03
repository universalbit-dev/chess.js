var cnnutil = (function(exports){

  var Window = function(size, minsize) {
    this.v = [];
    this.size = typeof(size)==='undefined' ? 100 : size;
    this.minsize = typeof(minsize)==='undefined' ? 20 : minsize;
    this.sum = 0;
  }
  Window.prototype = {
    add: function(x) {
      this.v.push(x);
      this.sum += x;
      if(this.v.length>this.size) {
        var xold = this.v.shift();
        this.sum -= xold;
      }
    },
    get_average: function() {
      if(this.v.length < this.minsize) return -1;
      else return this.sum/this.v.length;
    },
    reset: function(x) {
      this.v = [];
      this.sum = 0;
    }
  }

  // returns min, max and indeces of an array
  var maxmin = function(w) {
    if(w.length === 0) { return {}; } // ... ;s

    var maxv = w[0];
    var minv = w[0];
    var maxi = 0;
    var mini = 0;
    for(var i=1;i<w.length;i++) {
      if(w[i] > maxv) { maxv = w[i]; maxi = i; } 
      if(w[i] < minv) { minv = w[i]; mini = i; } 
    }
    return {maxi: maxi, maxv: maxv, mini: mini, minv: minv, dv:maxv-minv};
  }

  // returns string representation of float
  // but truncated to length of d digits
  var f2t = function(x, d) {
    if(typeof(d)==='undefined') { var d = 5; }
    var dd = 1.0 * Math.pow(10, d);
    return '' + Math.floor(x*dd)/dd;
  }

  exports = exports || {};
  exports.Window = Window;
  exports.maxmin = maxmin;
  exports.f2t = f2t;
  return exports;

})(typeof module != 'undefined' && module.exports);  // add exports to module.exports if in node.js

// ═══════════════════════════════════════════════════════════════════════════
// ─── MIT LICENSE COMPLIANCE HEADER ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ═══════════════════════════════════════════════════════════════════════════
