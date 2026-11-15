import { useRef } from 'react';

export default function ProductCardsComponent({ products, annotation, mobile = false, onProductTap }) {
  const scrollRef = useRef(null);
  const scrollAmount = 220;

  const scrollLeft = () => scrollRef.current?.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  const scrollRight = () => scrollRef.current?.scrollBy({ left: scrollAmount, behavior: 'smooth' });

  if (!products || products.length === 0) return null;

  return (
    <div className="relative w-full h-full flex flex-col p-3 bg-gray-100 overflow-hidden min-h-0 min-w-0">



      {/* Carousel Container — fills the remaining height so cards scale to fit */}
      <div className="relative w-full max-w-6xl mx-auto flex-1 min-h-0 flex items-center group">

        {/* Left Arrow */}
        <button
          onClick={scrollLeft}
          className="absolute left-[-18px] z-20 w-10 h-10 bg-white hover:bg-gray-50 border border-gray-200 rounded-full flex items-center justify-center text-gray-800 shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden md:flex hover:-translate-x-1"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Scroll Track — full height; cards derive their height from it.
            Centered when only a few cards fit (so they cover the center area
            evenly); left-aligned + scrollable once they overflow. */}
        <div
          ref={scrollRef}
          className={`flex gap-3 overflow-x-auto w-full h-full items-center ${products.length > 3 ? 'justify-start' : 'max-md:justify-start md:justify-center'} snap-x snap-mandatory scrollbar-hide px-4 py-2`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {products.map((product, idx) => {
            const productUrl = product.view_product_url || product.product_url || product.url || product.pdp_url
              || product.permalink || product.buy_now_url || product.checkout_url || null;
            const cartUrl = product.add_to_cart_url || product.cart_url || productUrl;
            return (
              <div
                key={idx}
                onClick={() => onProductTap?.(product)}
                role="button"
                className={`animate-fadein opacity-0 max-[1199px]:w-[65vw] max-[1199px]:max-w-[260px] min-[1200px]:h-full min-[1200px]:max-h-[600px] min-[1200px]:min-w-[280px] aspect-[3/4] snap-center flex-shrink-0 bg-white rounded-[10px] overflow-hidden border border-gray-200 shadow-[0_8px_30px_rgba(0,0,0,0.06)] flex flex-col transition-all duration-300 hover:border-gray-300 hover:shadow-2xl hover:-translate-y-2 cursor-pointer active:scale-[0.92] active:-translate-y-1`}
                style={{ animationDelay: `${idx * 150}ms` }}
              >
                {/* Card Image — flexible; fills the space above the content */}
                <div className="relative w-full flex-1 min-h-0 bg-gray-50 overflow-hidden flex items-center justify-center">
                  <img
                    src={product.featured_image || 'https://via.placeholder.com/300x400?text=No+Image'}
                    alt={product.title}
                    className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
                  />
                </div>

                {/* Card Content */}
                <div className="p-3 shrink-0 flex flex-col">
                  {/* Header: Title & Price */}
                  <div className="flex justify-between items-end gap-2 mb-2">
                    <h3 className="text-gray-900 font-bold text-[13px] leading-tight line-clamp-1 flex-1">
                      {product.title || product.product_title || product.name || 'Product'}
                    </h3>
                    <span className="text-gray-900 font-bold text-[13px] whitespace-nowrap tracking-tight">
                      Rs {product.min_price !== undefined ? product.min_price : product.price}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 mt-1">
                    <a
                      href={cartUrl || '#'}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled={!cartUrl}
                      onClick={(e) => { e.stopPropagation(); if (!cartUrl) e.preventDefault(); }}
                      className="w-full py-[7px] bg-gray-900 hover:bg-gray-800 text-white rounded-[4px] font-bold text-[10px] text-center transition-all uppercase tracking-[0.1em] shadow-md"
                    >
                      Add to Cart
                    </a>
                    <a
                      href={productUrl || '#'}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled={!productUrl}
                      onClick={(e) => { e.stopPropagation(); if (!productUrl) e.preventDefault(); }}
                      className="w-full py-[7px] bg-transparent hover:bg-gray-50 border border-gray-300 hover:border-gray-400 text-gray-700 rounded-[4px] font-bold text-[10px] text-center transition-all uppercase tracking-[0.1em]"
                    >
                      Visit
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Arrow */}
        <button
          onClick={scrollRight}
          className="absolute right-[-18px] z-20 w-10 h-10 bg-white hover:bg-gray-50 border border-gray-200 rounded-full flex items-center justify-center text-gray-800 shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden md:flex hover:translate-x-1"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
