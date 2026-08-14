import { useEffect, useMemo, useState } from "react";

import { ScrollableSelect } from "./ScrollableSelect";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50];

function getRowSearchText(row, columns) {
  return columns
    .filter((column) => column.key !== "actions")
    .map((column) => {
      if (column.searchValue) return column.searchValue(row);
      if (row[column.key] == null || row[column.key] === "") return "";
      return String(row[column.key]);
    })
    .join(" ")
    .toLowerCase();
}

export function ConfigDataTable({
  columns,
  rows,
  emptyMessage,
  variant = "dose",
  getRowKey,
  getRowClassName,
  onRowClick,
  selectedRowKey,
  searchable = false,
  searchPlaceholder = "Search...",
  searchQuery: controlledSearchQuery,
  onSearchChange,
  paginated = true,
  defaultPageSize = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  toolbarExtra = null,
  serverPagination = null,
}) {
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(defaultPageSize);

  const isServerPaginated = Boolean(serverPagination);
  const searchQuery = controlledSearchQuery ?? internalSearchQuery;
  const setSearchQuery = onSearchChange ?? setInternalSearchQuery;

  const page = isServerPaginated ? serverPagination.page : internalPage;
  const pageSize = isServerPaginated ? serverPagination.pageSize : internalPageSize;
  const setPage = isServerPaginated
    ? (nextPage) => {
        const resolved = typeof nextPage === "function" ? nextPage(page) : nextPage;
        serverPagination.onPageChange(resolved);
      }
    : setInternalPage;
  const setPageSize = isServerPaginated
    ? (nextSize) => {
        const resolved = typeof nextSize === "function" ? nextSize(pageSize) : nextSize;
        serverPagination.onPageSizeChange(resolved);
      }
    : setInternalPageSize;

  useEffect(() => {
    if (!isServerPaginated) {
      setInternalPage(1);
    }
  }, [searchQuery, pageSize, rows.length, isServerPaginated]);

  const filteredRows = useMemo(() => {
    if (!searchable || isServerPaginated || onSearchChange) return rows;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => getRowSearchText(row, columns).includes(query));
  }, [rows, columns, searchQuery, searchable, isServerPaginated, onSearchChange]);

  const totalItems = isServerPaginated ? serverPagination.totalCount : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + (isServerPaginated ? rows.length : filteredRows.length), totalItems);
  const showPagination = paginated;
  const needsPagination = paginated && totalItems > pageSize;
  const visibleRows = isServerPaginated
    ? rows
    : needsPagination
      ? filteredRows.slice(startIndex, startIndex + pageSize)
      : filteredRows;

  useEffect(() => {
    if (!isServerPaginated && internalPage !== safePage) {
      setInternalPage(safePage);
    }
  }, [internalPage, safePage, isServerPaginated]);

  const showToolbar = searchable || toolbarExtra;
  const hasActiveSearch = Boolean(searchQuery.trim());

  return (
    <div
      className={`config-data-table config-data-table--${variant}${showToolbar || showPagination ? " config-data-table--managed" : ""}`}
    >
      {showToolbar && (
        <div className="config-data-table__toolbar">
          {toolbarExtra ? <div className="config-data-table__toolbar-extra">{toolbarExtra}</div> : null}
          {searchable && (
            <label className="config-data-table__search">
              <span className="config-data-table__search-label">Search</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </label>
          )}
        </div>
      )}

      <div className="config-data-table__scroll">
        <div className="config-data-table__head">
          {columns.map((column) => (
            <span key={column.key} className={column.align ? `config-data-table__cell--${column.align}` : undefined}>
              {column.label}
            </span>
          ))}
        </div>
        {visibleRows.length === 0 ? (
          <p className="config-data-table__empty">
            {hasActiveSearch ? "No matching records found." : emptyMessage}
          </p>
        ) : (
          visibleRows.map((row, index) => {
            const absoluteIndex = startIndex + index;
            const rowKey = getRowKey ? getRowKey(row, absoluteIndex) : row.id ?? absoluteIndex;
            const rowClassName = getRowClassName?.(row, absoluteIndex) ?? "";
            const isSelected = selectedRowKey != null && selectedRowKey === rowKey;
            const classNames = [
              "config-data-table__row",
              rowClassName,
              isSelected ? "config-data-table__row--selected" : "",
              onRowClick ? "config-data-table__row--clickable" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const handleActivate = () => onRowClick?.(row);

            return (
              <div
                key={rowKey}
                className={classNames}
                onClick={onRowClick ? handleActivate : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleActivate();
                        }
                      }
                    : undefined
                }
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((column) => (
                  <span
                    key={column.key}
                    data-label={column.label}
                    className={[
                      column.align ? `config-data-table__cell--${column.align}` : "",
                      column.cellClassName?.(row) ?? "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    onClick={
                      column.key === "actions" || column.stopRowClick
                        ? (event) => event.stopPropagation()
                        : undefined
                    }
                  >
                    {column.render ? column.render(row, absoluteIndex) : row[column.key]}
                  </span>
                ))}
              </div>
            );
          })
        )}
      </div>

      {showPagination && (
        <div className="config-data-table__pagination">
          <div className="config-data-table__pagination-meta">
            <span>
              Showing {totalItems === 0 ? 0 : startIndex + 1}–{endIndex} of {totalItems}
            </span>
            <label className="config-data-table__page-size">
              <ScrollableSelect
                className="scrollable-select--compact"
                value={pageSize}
                onChange={(nextValue) => setPageSize(Number(nextValue))}
                options={pageSizeOptions.map((option) => ({
                  value: option,
                  label: `${option} / page`,
                }))}
                allowEmpty={false}
                ariaLabel="Rows per page"
              />
            </label>
          </div>
          <div className="config-data-table__pager">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Prev
            </button>
            <span>
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
