/* grips (c) 2012 Kyle Simpson | http://getify.mit-license.org/ */
(function __grips_amd__(){
;

// non-ES5 polyfill for Object.keys()
if (!Object.keys) {
	Object.keys = function __Object_keys__(obj) {
		var i, r = [];
		for (i in obj) { if (obj.hasOwnProperty(i)) {
			r.push(i);
		}}
		return r;
	};
}


// non-ES5 polyfill for Object.create()
if (!Object.create) {
    Object.create = function __Object_create__(o) {
        function F(){}
        F.prototype = o;
        return new F();
    };
}

// circular-ref safe JSON.stringify() via Object.prototype.toJSON()
// https://gist.github.com/3373779
if (!Object.prototype.toJSON) {
	Object.prototype.toJSON = function __Object_toJSON__() {
		function findCircularRef(obj) {
			for (var i=0; i<refs.length; i++) {
				if (refs[i] === obj) return true;
			}
			return false;
		}

		function traverse(obj) {
			function element(el) {
				if (typeof el === "object") {
					if (el !== null) {
						if (Date === el.constructor || Number === el.constructor || Boolean === el.constructor || String === el.constructor || RegExp === el.constructor) {
							return el;
						}
						else if (!findCircularRef(el)) {
							return traverse(el);
						}
					}
					return null;
				}
				return el;
			}

			var idx, tmp, tmp2;

			if (Object.prototype.toString.call(obj) === "[object Array]") {
				refs.push(obj);
				tmp = [];
				for (idx=0; idx<obj.length; idx++) {
					tmp.push(element(obj[idx]));
				}
				refs.pop();
				return tmp;
			}
			else if (typeof obj === "object") {
				if (obj !== null) {
					if (Date === obj.constructor || Number === obj.constructor || String === obj.constructor || Boolean === obj.constructor || RegExp === obj.constructor) {
						return obj;
					}
					else if (!findCircularRef(obj)) {
						refs.push(obj);
						tmp = {};
						for (idx in obj) { if (obj.hasOwnProperty(idx)) {
							tmp2 = element(obj[idx]);
							if (tmp2 !== null) tmp[idx] = tmp2;
						}}
						refs.pop();
						return tmp;
					}
				}
				return null;
			}
			else return obj;
		}

		var refs = [], ret;
		ret = traverse(this);
		refs = [];
		return ret;
	};

	// ES5-only: prevent this `toJSON()` from showing up in for-in loops
	if (Object.defineProperty) {
		Object.defineProperty(Object.prototype,"toJSON",{enumerable:false});
	}
}


(function __grips_base__(global){
	var old_grips = global.grips;

	function createSandbox() {


		/* TemplateError */
		var TemplateError = (function TemplateError() {
			function F(){}
			function CustomError(msg,ref,stack) {
				// correct if not called with "new"
				var self = (this===global) ? new F() : this;
				self.message = msg;
				self.ref = ref;
				self.stack = stack;
				return self;
			}
			F.prototype = CustomError.prototype = Object.create(ReferenceError.prototype);
			CustomError.prototype.constructor = CustomError;

			CustomError.prototype.toString = function __TemplateError_toString__() {
				var ret = "TemplateError: " + this.message;
				if (this.ref) {
					ret += "; " + JSON.stringify(this.ref);
				}
				ret = ret.replace(/[\n\r]+/g," ").replace(/\s+/g," ");
				if (this.stack) {
					ret += "\n" + this.stack;
				}
				return ret;
			};
			return CustomError;
		})();


		function RangeLiteralHash() {} // work-around for Chrome object iteration quirks

		function noConflict() {
			var new_grips = global.grips;
			global.grips = old_grips;
			return new_grips;
		}

		function initCollectionRecord(collectionID) {
			if (!(collectionID in collections)) {
				collections[collectionID] = {
					collection: "",
					extend: null,
					partials: {}
				};
			}
		}

		function extend(collectionID,id) {
			initCollectionRecord(collectionID);
			collections[collectionID].extend = id;
		}

		function cloneObj(obj) {
			var i, ret, ret2;
			if (typeof obj === "object") {
				if (obj === null) return obj;
				if (Object.prototype.toString.call(obj) === "[object Array]") {
					ret = [];
					for (i = 0; i < obj.length; i++) {
						if (typeof obj[i] === "object") {
							ret2 = cloneObj(obj[i]);
						}
						else {
							ret2 = obj[i];
						}
						ret.push(ret2);
					}
				}
				else {
					if (obj instanceof RangeLiteralHash) {
						ret = new RangeLiteralHash();
					}
					else {
						ret = {};
					}
					for (i in obj) {
						if (obj.hasOwnProperty(i)) {
							if (typeof(obj[i] === "object")) {
								ret2 = cloneObj(obj[i]);
							}
							else {
								ret2 = obj[i];
							}
							ret[i] = ret2;
						}
					}
				}
			}
			else {
				ret = obj;
			}
			return ret;
		}


		function error(collectionID,obj,msg,errObj) {
			msg = "[" + collectionID + "] " + msg;
			if (errObj) {
				msg += "; " + errObj.toString();
			}
			return new TemplateError(msg,obj,(errObj ? errObj.stack : null));
		}


		function definePartial(fn,id,obj) {
			var collection_id = id.match(/^(.+)#/);
			if (collection_id) {
				collection_id = collection_id[1];
			}

			if (!collection_id) {
				throw new TemplateError("Missing collection ID: " + id) ||unknown_error;
			}

			initCollectionRecord(collection_id);

			collections[collection_id].partials[id.replace(/^.*#/,"#")] = function __handle_partial__(){
				var _err, ret;

				try {
					ret = fn.apply(_Grips,arguments);
				}
				catch (err) {

					_err = error(collection_id,obj,"Unexpected error",err);
					_err.stack = err.stack; // try to preserve the original error call stack, if possible
					throw _err;

					throw unknown_error;
				}

				if (ret instanceof Error) {
					throw ret;
				}
				else {
					return ret;
				}
			};
		}



		function render(id,$,$$) {
			// default empty render?
			if (!id) return "";

			var collection_id, ret, i, tmp, eligible_stack = [],
				collection_id_specified = false, collection_stack_pushed = false
			;

			// extract the collection ID, if any
			collection_id = id.match(/^(.+)#/);
			if (collection_id) {
				collection_id = collection_id[1];
				collection_id_specified = true;
			}

			// collection ID not specified but can be implied from stack?
			if (!collection_id_specified && render_collection_stack.length > 0) {
				collection_id = render_collection_stack[render_collection_stack.length-1];
			}
			// collection ID specified and not already on the stack?
			else if (collection_id_specified &&
				!(
					render_collection_stack.length > 0 &&
					render_collection_stack[render_collection_stack.length-1] === collection_id
				)
			) {
				render_collection_stack.push(collection_id);
				collection_stack_pushed = true;
			}
			// collection ID just plain missing
			else if (!collection_id) {
				throw new TemplateError("Required collection ID missing: " + id) ||unknown_error;
			}

			if (collection_id in collections) {
				id = id.replace(/^(.+)#/,"#");
				tmp = collection_id + id;
				render_partials_stack.push(tmp);

				// is there a recursive template include present?
				for (i=0; i<(render_partials_stack.length-1); i++) {
					if (render_partials_stack[i] === tmp) {
						throw new TemplateError("Recursive template include: " + tmp) ||unknown_error;
					}
				}

				// do we need to consult the current render stack?
				if (!collection_id_specified) {
					eligible_stack = eligible_stack.concat(render_collection_stack);
				}
				else {
					eligible_stack.push(collection_id);
				}

				// do we possibly need to consult the extensions stack?
				if (!(id in collections[collection_id].partials) &&
					collections[collection_id].extend
				) {
					// add any extensions onto the eligible stack
					tmp = collections[collection_id].extend;
					while (tmp && tmp in collections) {
						eligible_stack.push(tmp);
						tmp = collections[tmp].extend;
					}
				}

				// consult the eligible stack from the bottom up
				for (i=0; i<eligible_stack.length; i++) {
					if (id in collections[eligible_stack[i]].partials) {
						ret = collections[eligible_stack[i]].partials[id]($,$$);
						break;
					}
				}
			}

			if (ret) {
				render_partials_stack.pop();
				if (collection_stack_pushed) {
					render_collection_stack.pop();
				}
				return ret;
			}
			else {
				throw new TemplateError("[" + id + "] Template not found") ||unknown_error;
			}
		}


		var _Grips, collections = {},
			unknown_error = new Error("Unknown error"),
			render_collection_stack = [], render_partials_stack = []
		;

		_Grips = {
			extend: extend,
			cloneObj: cloneObj,
			error: error,
			definePartial: definePartial,



			render: render,

			TemplateError: TemplateError,

			noConflict: noConflict,
			sandbox: createSandbox,

			RangeLiteralHash: RangeLiteralHash
		};

		return _Grips;
	}

	global.grips = createSandbox();

})(this);
;


;


;



var g = this.grips;
if (typeof define === "function" && define.amd) {
define(g);
}
}).call({});