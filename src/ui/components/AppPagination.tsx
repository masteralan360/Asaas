import React from 'react'
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from './ui/pagination'

interface AppPaginationProps {
    currentPage: number
    totalCount: number
    pageSize: number
    onPageChange: (page: number) => void
    className?: string
}

export const AppPagination: React.FC<AppPaginationProps> = ({
    currentPage,
    totalCount,
    pageSize,
    onPageChange,
    className
}) => {
    const totalPages = Math.ceil(totalCount / pageSize)

    if (totalPages <= 1) return null

    const renderPageItems = () => {
        const items = []
        const siblingCount = 1 // Number of pages either side of current page

        // Determine range of pages to show
        let startPage = Math.max(1, currentPage - siblingCount)
        let endPage = Math.min(totalPages, currentPage + siblingCount)

        // Always show page 1
        if (startPage > 1) {
            items.push(
                <PaginationItem key={1}>
                    <PaginationLink onClick={() => onPageChange(1)}>1</PaginationLink>
                </PaginationItem>
            )
            if (startPage > 2) {
                items.push(
                    <PaginationItem key="ellipsis-start">
                        <PaginationEllipsis />
                    </PaginationItem>
                )
            }
        }

        // Main range
        for (let i = startPage; i <= endPage; i++) {
            items.push(
                <PaginationItem key={i}>
                    <PaginationLink
                        isActive={currentPage === i}
                        onClick={() => onPageChange(i)}
                        className="cursor-pointer"
                    >
                        {i}
                    </PaginationLink>
                </PaginationItem>
            )
        }

        // Always show last page
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                items.push(
                    <PaginationItem key="ellipsis-end">
                        <PaginationEllipsis />
                    </PaginationItem>
                )
            }
            items.push(
                <PaginationItem key={totalPages}>
                    <PaginationLink onClick={() => onPageChange(totalPages)}>{totalPages}</PaginationLink>
                </PaginationItem>
            )
        }

        return items
    }

    return (
        <Pagination className={className}>
            <PaginationContent>
                <PaginationItem>
                    <PaginationPrevious
                        onClick={() => currentPage > 1 && onPageChange(currentPage - 1)}
                        className={currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                </PaginationItem>

                {renderPageItems()}

                <PaginationItem>
                    <PaginationNext
                        onClick={() => currentPage < totalPages && onPageChange(currentPage + 1)}
                        className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    )
}
